import logging
import math

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response

from crate.api._deps import enrich_radio_tracks as _enrich_radio_tracks, library_path, safe_path
from crate.api.auth import _require_auth
from crate.api.browse_shared import _YEAR_PREFIX_RE, fs_search, has_library_data
from crate.db import get_cache, get_db_ctx, set_cache

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/api/search")
def api_search(request: Request, q: str = "", limit: int = 20):
    _require_auth(request)
    q_stripped = q.strip()
    capped_limit = max(1, min(limit, 50))
    if len(q_stripped) < 2:
        return {"artists": [], "albums": [], "tracks": []}

    if not has_library_data():
        result = fs_search(q_stripped)
        result["tracks"] = []
        return result

    like = f"%{q_stripped}%"
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT id, slug, name, album_count, has_photo
            FROM library_artists
            WHERE name ILIKE %s
            ORDER BY listeners DESC NULLS LAST, album_count DESC, name ASC
            LIMIT %s
            """,
            (like, capped_limit),
        )
        artist_rows = cur.fetchall()
        cur.execute(
            """
            SELECT a.id, a.slug, a.artist, a.name, a.year, a.has_cover,
                   ar.id AS artist_id, ar.slug AS artist_slug
            FROM library_albums a
            LEFT JOIN library_artists ar ON ar.name = a.artist
            WHERE a.name ILIKE %s OR a.artist ILIKE %s
            ORDER BY year DESC NULLS LAST, name ASC
            LIMIT %s
            """,
            (like, like, capped_limit),
        )
        album_rows = cur.fetchall()
        cur.execute(
            """
            SELECT t.id, t.storage_id, t.slug, t.title, t.artist, a.id AS album_id, a.slug AS album_slug,
                   a.name AS album, ar.id AS artist_id, ar.slug AS artist_slug,
                   t.path, t.duration
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            LEFT JOIN library_artists ar ON ar.name = t.artist
            WHERE t.title ILIKE %s OR t.artist ILIKE %s OR a.name ILIKE %s
            ORDER BY t.title ASC
            LIMIT %s
            """,
            (like, like, like, capped_limit),
        )
        track_rows = cur.fetchall()

    artists = [
        {
            "id": row["id"],
            "slug": row.get("slug"),
            "name": row["name"],
            "album_count": row.get("album_count", 0),
            "has_photo": bool(row.get("has_photo")),
        }
        for row in artist_rows
    ]
    albums = [
        {
            "id": row["id"],
            "slug": row.get("slug"),
            "artist": row["artist"],
            "artist_id": row.get("artist_id"),
            "artist_slug": row.get("artist_slug"),
            "name": row["name"],
            "year": row.get("year") or "",
            "has_cover": bool(row.get("has_cover")),
        }
        for row in album_rows
    ]
    tracks = [
        {
            "id": row["id"],
            "storage_id": str(row["storage_id"]) if row.get("storage_id") is not None else None,
            "slug": row.get("slug"),
            "title": row["title"],
            "artist": row["artist"],
            "artist_id": row.get("artist_id"),
            "artist_slug": row.get("artist_slug"),
            "album_id": row.get("album_id"),
            "album_slug": row.get("album_slug"),
            "album": row["album"],
            "path": row["path"],
            "duration": row["duration"],
        }
        for row in track_rows
    ]
    return {"artists": artists, "albums": albums, "tracks": tracks}


@router.get("/api/favorites")
def api_favorites_list(request: Request):
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute("SELECT item_type, item_id, created_at FROM favorites ORDER BY created_at DESC")
        items = [dict(row) for row in cur.fetchall()]
    return {"items": items}


@router.post("/api/favorites/add")
def api_favorites_add(request: Request, body: dict):
    _require_auth(request)
    from datetime import datetime, timezone

    item_id = body.get("item_id", "")
    item_type = body.get("type", "song")
    if not item_id:
        return Response(status_code=400)
    if item_type not in ("song", "album", "artist"):
        return JSONResponse({"error": "type must be song, album, or artist"}, status_code=400)

    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO favorites (item_type, item_id, created_at) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
            (item_type, item_id, now),
        )

    return {"ok": True}


@router.post("/api/favorites/remove")
def api_favorites_remove(request: Request, body: dict):
    _require_auth(request)
    item_id = body.get("item_id", "")
    item_type = body.get("type", "song")
    if not item_id:
        return Response(status_code=400)
    if item_type not in ("song", "album", "artist"):
        return JSONResponse({"error": "type must be song, album, or artist"}, status_code=400)

    with get_db_ctx() as cur:
        cur.execute("DELETE FROM favorites WHERE item_id = %s AND item_type = %s", (item_id, item_type))

    return {"ok": True}


@router.post("/api/track/rate")
def api_rate_track(request: Request, body: dict):
    _require_auth(request)
    from crate.db import set_track_rating

    rating = body.get("rating", 0)
    track_id = body.get("track_id")
    track_path = body.get("path")

    if not isinstance(rating, int) or not 0 <= rating <= 5:
        return JSONResponse({"error": "Rating must be 0-5"}, status_code=400)

    if not track_id and track_path:
        with get_db_ctx() as cur:
            cur.execute("SELECT id FROM library_tracks WHERE path LIKE %s LIMIT 1", (f"%{track_path}",))
            row = cur.fetchone()
            track_id = row["id"] if row else None

    if not track_id:
        return JSONResponse({"error": "Track not found"}, status_code=404)

    set_track_rating(track_id, rating)
    return {"ok": True, "rating": rating}


_TRACK_INFO_QUERY_COLS = (
    "title, artist, album, format, bitrate, sample_rate, bit_depth, "
    "bpm, audio_key, audio_scale, energy, "
    "danceability, valence, acousticness, instrumentalness, loudness, "
    "dynamic_range, mood_json, bliss_vector, lastfm_listeners, lastfm_playcount, popularity, rating"
)


def _derive_bliss_signature(bliss_vector) -> dict[str, float] | None:
    if not isinstance(bliss_vector, (list, tuple)) or not bliss_vector:
        return None

    values: list[float] = []
    for value in bliss_vector:
        try:
            values.append(float(value))
        except (TypeError, ValueError):
            continue

    if not values:
        return None

    mean_abs = sum(abs(value) for value in values) / len(values)
    density_raw = math.sqrt(sum(value * value for value in values) / len(values))
    diffs = [abs(values[i] - values[i - 1]) for i in range(1, len(values))]
    texture_raw = sum(diffs) / len(diffs) if diffs else 0.0
    half = max(1, len(values) // 2)
    front = sum(values[:half]) / half
    back = sum(values[half:]) / max(1, len(values) - half)
    motion_raw = abs(back - front)

    return {
        "texture": round(math.tanh(texture_raw * 1.35), 3),
        "motion": round(math.tanh((motion_raw + mean_abs * 0.35) * 1.55), 3),
        "density": round(math.tanh((density_raw * 0.9 + mean_abs * 0.5) * 1.2), 3),
    }


def _serialize_track_info_row(row) -> dict:
    payload = dict(row)
    bliss_vector = payload.pop("bliss_vector", None)
    payload["bliss_signature"] = _derive_bliss_signature(bliss_vector)
    return payload


@router.get("/api/tracks/{track_id}/info")
def api_track_info_by_id(request: Request, track_id: int):
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute(f"SELECT {_TRACK_INFO_QUERY_COLS} FROM library_tracks WHERE id = %s", (track_id,))
        row = cur.fetchone()
    if not row:
        return Response(status_code=404)
    return _serialize_track_info_row(row)


@router.get("/api/tracks/by-storage/{storage_id}/info")
def api_track_info_by_storage_id(request: Request, storage_id: str):
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute(f"SELECT {_TRACK_INFO_QUERY_COLS} FROM library_tracks WHERE storage_id = %s", (storage_id,))
        row = cur.fetchone()
    if not row:
        return Response(status_code=404)
    return _serialize_track_info_row(row)


@router.get("/api/track-info/{filepath:path}")
def api_track_info(request: Request, filepath: str):
    _require_auth(request)
    if filepath.startswith("/music/"):
        filepath = filepath[len("/music/") :]

    with get_db_ctx() as cur:
        cur.execute(
            f"SELECT {_TRACK_INFO_QUERY_COLS} FROM library_tracks WHERE path LIKE %s LIMIT 1",
            (f"%{filepath}",),
        )
        row = cur.fetchone()

    if not row:
        return Response(status_code=404)
    return _serialize_track_info_row(row)


# ── EQ adaptive features ────────────────────────────────────────────
#
# Minimal subset of audio-analysis columns exposed for the client-side
# adaptive equalizer heuristic. Keep this narrow: the front-end shouldn't
# learn about every analysis column we persist, and this payload gets
# requested on every track change when the user selects the "adaptive"
# preset — a smaller JSON = fewer bytes on the wire and a clearer
# contract.
#
# spectral_complexity already lives in [0, 1] (normalized centroid at
# analysis time), so it doubles as a brightness indicator.

_EQ_FEATURES_QUERY_COLS = (
    "energy, loudness, dynamic_range, spectral_complexity, "
    "danceability, valence, acousticness, instrumentalness"
)


def _serialize_eq_features(row) -> dict:
    """Normalize nullable floats + expose canonical frontend keys."""
    data = dict(row)
    return {
        "energy": data.get("energy"),
        "loudness": data.get("loudness"),              # LUFS, roughly -30..-6
        "dynamicRange": data.get("dynamic_range"),     # dB crest-like
        "brightness": data.get("spectral_complexity"), # normalized centroid 0..1
        "danceability": data.get("danceability"),
        "valence": data.get("valence"),
        "acousticness": data.get("acousticness"),
        "instrumentalness": data.get("instrumentalness"),
    }


@router.get("/api/tracks/{track_id}/eq-features")
def api_eq_features_by_id(request: Request, track_id: int):
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute(
            f"SELECT {_EQ_FEATURES_QUERY_COLS} FROM library_tracks WHERE id = %s",
            (track_id,),
        )
        row = cur.fetchone()
    if not row:
        return Response(status_code=404)
    return _serialize_eq_features(row)


@router.get("/api/tracks/by-storage/{storage_id}/eq-features")
def api_eq_features_by_storage_id(request: Request, storage_id: str):
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute(
            f"SELECT {_EQ_FEATURES_QUERY_COLS} FROM library_tracks WHERE storage_id = %s",
            (storage_id,),
        )
        row = cur.fetchone()
    if not row:
        return Response(status_code=404)
    return _serialize_eq_features(row)


# ── Track primary genre ─────────────────────────────────────────────
#
# Returns the dominant genre for a track, used by the "Genre Adaptive"
# equalizer mode. We pick the highest-weight canonical genre from the
# track's album; if no album genres exist (or none are canonical) we
# fall back to the artist's genres. Non-canonical tags (raw Last.fm
# noise like "blackened-post-sludge") are still returned if nothing
# canonical is available, but `primary.canonical = false` tells the
# client to skip preset lookup.

def _pick_primary_genre(rows):
    """Prefer the highest-weight canonical genre; fall back to the
    highest-weight raw tag if none resolve cleanly. Canonical picks
    also carry the resolved EQ preset (direct or inherited)."""
    from crate.genre_taxonomy import (
        get_genre_display_name,
        get_top_level_slug,
        is_canonical_genre_slug,
        resolve_genre_eq_preset,
        resolve_genre_slug,
    )

    canonical_pick = None
    raw_pick = None

    for row in rows:
        raw_slug = (row.get("slug") or "").strip().lower()
        raw_name = (row.get("name") or "").strip().lower()
        resolved = resolve_genre_slug(raw_name or raw_slug)
        if resolved and is_canonical_genre_slug(resolved):
            if canonical_pick is None:
                top_level_slug = get_top_level_slug(resolved) or resolved
                preset_info = resolve_genre_eq_preset(resolved)
                preset_payload = None
                if preset_info is not None:
                    preset_payload = {
                        "gains": preset_info["gains"],
                        "source": preset_info["source"],
                        "inheritedFrom": (
                            {"slug": preset_info["slug"], "name": preset_info["name"]}
                            if preset_info["source"] == "inherited"
                            else None
                        ),
                    }
                canonical_pick = {
                    "primary": {
                        "slug": resolved,
                        "name": get_genre_display_name(resolved),
                        "canonical": True,
                    },
                    "topLevel": {
                        "slug": top_level_slug,
                        "name": get_genre_display_name(top_level_slug),
                    },
                    "preset": preset_payload,
                }
        elif raw_pick is None:
            raw_pick = {
                "primary": {
                    "slug": raw_slug or resolved or "",
                    "name": raw_name or (raw_slug.replace("-", " ") if raw_slug else ""),
                    "canonical": False,
                },
                "topLevel": None,
                "preset": None,
            }

    return canonical_pick or raw_pick


def _resolve_track_genre(cur, track_id: int) -> dict | None:
    cur.execute(
        """
        SELECT g.name, g.slug, ag.weight
        FROM library_tracks t
        JOIN album_genres ag ON ag.album_id = t.album_id
        JOIN genres g ON g.id = ag.genre_id
        WHERE t.id = %s
        ORDER BY ag.weight DESC NULLS LAST, g.name ASC
        LIMIT 10
        """,
        (track_id,),
    )
    album_rows = cur.fetchall()
    picked = _pick_primary_genre(album_rows) if album_rows else None
    if picked:
        picked["source"] = "album"
        return picked

    cur.execute(
        """
        SELECT g.name, g.slug, arg.weight
        FROM library_tracks t
        JOIN artist_genres arg ON arg.artist_name = t.artist
        JOIN genres g ON g.id = arg.genre_id
        WHERE t.id = %s
        ORDER BY arg.weight DESC NULLS LAST, g.name ASC
        LIMIT 10
        """,
        (track_id,),
    )
    artist_rows = cur.fetchall()
    picked = _pick_primary_genre(artist_rows) if artist_rows else None
    if picked:
        picked["source"] = "artist"
        return picked

    return None


@router.get("/api/tracks/{track_id}/genre")
def api_track_genre_by_id(request: Request, track_id: int):
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute("SELECT 1 FROM library_tracks WHERE id = %s", (track_id,))
        if not cur.fetchone():
            return Response(status_code=404)
        result = _resolve_track_genre(cur, track_id)
    if result is None:
        return {"primary": None, "topLevel": None, "source": None, "preset": None}
    return result


@router.get("/api/tracks/by-storage/{storage_id}/genre")
def api_track_genre_by_storage_id(request: Request, storage_id: str):
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute("SELECT id FROM library_tracks WHERE storage_id = %s", (storage_id,))
        row = cur.fetchone()
        if not row:
            return Response(status_code=404)
        result = _resolve_track_genre(cur, row["id"])
    if result is None:
        return {"primary": None, "topLevel": None, "source": None, "preset": None}
    return result


@router.get("/api/discover/completeness")
def api_discover_completeness(request: Request):
    """Return cached completeness data. The heavy computation runs as a worker task."""
    _require_auth(request)
    cached = get_cache("discover:completeness", max_age_seconds=86400)
    if cached is not None:
        return cached
    # No cached data — queue a worker task to compute it
    from crate.db import create_task_dedup
    create_task_dedup("compute_completeness", {})
    return []


@router.post("/api/discover/completeness/refresh")
def api_discover_completeness_refresh(request: Request):
    """Force recompute of completeness data."""
    _require_auth(request)
    from crate.db import create_task_dedup
    task_id = create_task_dedup("compute_completeness", {})
    return {"task_id": task_id}


_STREAM_MEDIA_TYPES = {
    ".flac": "audio/flac",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
    ".wav": "audio/wav",
}


def _stream_file(request: Request, filepath: str):
    _require_auth(request)
    from fastapi.responses import FileResponse

    lib = library_path()
    lib_str = str(lib)
    if filepath.startswith(lib_str):
        filepath = filepath[len(lib_str):].lstrip("/")
    elif filepath.startswith("/music/"):
        filepath = filepath[len("/music/"):].lstrip("/")
    file_path = safe_path(lib, filepath)
    if not file_path or not file_path.is_file():
        return Response(status_code=404)

    ext = file_path.suffix.lower()
    return FileResponse(
        path=str(file_path),
        media_type=_STREAM_MEDIA_TYPES.get(ext, "audio/mpeg"),
        headers={"Accept-Ranges": "bytes"},
    )


@router.get("/api/tracks/{track_id}/stream")
def api_stream_by_id(request: Request, track_id: int):
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute("SELECT path FROM library_tracks WHERE id = %s", (track_id,))
        row = cur.fetchone()
    if not row:
        return Response(status_code=404)
    return _stream_file(request, row["path"])


@router.get("/api/tracks/by-storage/{storage_id}/stream")
def api_stream_by_storage_id(request: Request, storage_id: str):
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute("SELECT path FROM library_tracks WHERE storage_id = %s", (storage_id,))
        row = cur.fetchone()
    if not row:
        return Response(status_code=404)
    return _stream_file(request, row["path"])


@router.get("/api/stream/{filepath:path}")
def api_stream_file(request: Request, filepath: str):
    return _stream_file(request, filepath)


@router.get("/api/similar-tracks")
def api_similar_tracks_query(request: Request, path: str = "", track_id: int = 0, limit: int = 20):
    _require_auth(request)
    from crate.bliss import get_similar_from_db

    if track_id:
        with get_db_ctx() as cur:
            cur.execute("SELECT path FROM library_tracks WHERE id = %s", (track_id,))
            row = cur.fetchone()
            if row:
                path = row["path"]

    if not path:
        raise HTTPException(status_code=400, detail="path or track_id required")

    results = get_similar_from_db(path, limit=limit)
    return {"tracks": _enrich_radio_tracks(results)}


@router.get("/api/similar-tracks/{filepath:path}")
def api_similar_tracks(request: Request, filepath: str, limit: int = 20):
    _require_auth(request)
    from crate.bliss import get_similar_from_db

    lib = library_path()
    full_path = safe_path(lib, filepath)
    if not full_path or not full_path.is_file():
        return JSONResponse({"error": "Track not found"}, status_code=404)
    similar = get_similar_from_db(str(full_path), limit=limit)
    return {"tracks": _enrich_radio_tracks(similar)}


def _download_track(request: Request, filepath: str):
    _require_auth(request)
    from fastapi.responses import FileResponse

    lib = library_path()
    lib_str = str(lib)
    if filepath.startswith(lib_str):
        filepath = filepath[len(lib_str):].lstrip("/")
    elif filepath.startswith("/music/"):
        filepath = filepath[len("/music/"):].lstrip("/")
    file_path = safe_path(lib, filepath)
    if not file_path or not file_path.is_file():
        return Response(status_code=404)

    return FileResponse(path=str(file_path), filename=file_path.name, media_type="application/octet-stream")


@router.get("/api/tracks/{track_id}/download")
def api_download_track_by_id(request: Request, track_id: int):
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute("SELECT path FROM library_tracks WHERE id = %s", (track_id,))
        row = cur.fetchone()
    if not row:
        return Response(status_code=404)
    return _download_track(request, row["path"])


@router.get("/api/tracks/by-storage/{storage_id}/download")
def api_download_track_by_storage_id(request: Request, storage_id: str):
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute("SELECT path FROM library_tracks WHERE storage_id = %s", (storage_id,))
        row = cur.fetchone()
    if not row:
        return Response(status_code=404)
    return _download_track(request, row["path"])


@router.get("/api/download/track/{filepath:path}")
def api_download_track(request: Request, filepath: str):
    return _download_track(request, filepath)


# ── Mood/Energy browse ──────────────────────────────────────────

MOOD_PRESETS = {
    "energetic": {"energy_min": 0.7, "danceability_min": 0.5},
    "chill": {"energy_max": 0.4, "valence_min": 0.3},
    "dark": {"valence_max": 0.3, "energy_min": 0.4},
    "happy": {"valence_min": 0.6, "energy_min": 0.4},
    "melancholy": {"valence_max": 0.35, "energy_max": 0.5},
    "intense": {"energy_min": 0.8},
    "groovy": {"danceability_min": 0.65, "energy_min": 0.45},
    "acoustic": {"acousticness_min": 0.6},
}


@router.get("/api/browse/moods")
def api_browse_moods(request: Request):
    """Return available mood presets with track counts."""
    _require_auth(request)
    from crate.db import get_db_ctx
    results = []
    with get_db_ctx() as cur:
        for name, filters in MOOD_PRESETS.items():
            conditions = ["bpm IS NOT NULL"]
            params: list = []
            for key, val in filters.items():
                col = key.rsplit("_", 1)[0]
                op = ">" if key.endswith("_min") else "<"
                conditions.append(f"{col} {op}= %s")
                params.append(val)
            cur.execute(
                f"SELECT COUNT(*) AS cnt FROM library_tracks WHERE {' AND '.join(conditions)}",
                params,
            )
            count = cur.fetchone()["cnt"]
            results.append({"name": name, "track_count": count, "filters": filters})
    return results


@router.get("/api/browse/mood/{mood}")
def api_browse_mood_tracks(request: Request, mood: str, limit: int = Query(50, ge=1, le=200)):
    """Return tracks matching a mood preset."""
    _require_auth(request)
    preset = MOOD_PRESETS.get(mood)
    if not preset:
        raise HTTPException(status_code=404, detail=f"Unknown mood: {mood}")
    from crate.db import get_db_ctx
    conditions = ["bpm IS NOT NULL"]
    params: list = []
    for key, val in preset.items():
        col = key.rsplit("_", 1)[0]
        op = ">" if key.endswith("_min") else "<"
        conditions.append(f"{col} {op}= %s")
        params.append(val)
    params.append(limit)
    with get_db_ctx() as cur:
        cur.execute(
            f"""SELECT t.id, t.storage_id, t.title, t.artist, a.name AS album, t.path, t.duration,
                       ar.id AS artist_id, ar.slug AS artist_slug,
                       a.id AS album_id, a.slug AS album_slug,
                       t.bpm, t.energy, t.danceability, t.valence
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                LEFT JOIN library_artists ar ON ar.name = t.artist
                WHERE {' AND '.join(conditions)}
                ORDER BY RANDOM() LIMIT %s""",
            params,
        )
        tracks = [dict(r) for r in cur.fetchall()]
    return {"mood": mood, "filters": preset, "tracks": tracks, "count": len(tracks)}
