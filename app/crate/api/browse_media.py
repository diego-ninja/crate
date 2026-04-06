import logging

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
            SELECT t.id, t.slug, t.title, t.artist, a.id AS album_id, a.slug AS album_slug,
                   a.name AS album, ar.id AS artist_id, ar.slug AS artist_slug,
                   t.path, t.duration, t.navidrome_id
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
            "navidrome_id": row["navidrome_id"],
        }
        for row in track_rows
    ]
    return {"artists": artists, "albums": albums, "tracks": tracks}


@router.get("/api/favorites")
def api_favorites_list(request: Request):
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute("SELECT item_type, item_id, navidrome_id, created_at FROM favorites ORDER BY created_at DESC")
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

    if "/" not in item_id and len(item_id) < 40:
        try:
            from crate import navidrome

            navidrome.star(item_id, item_type)
        except Exception:
            pass
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

    if "/" not in item_id and len(item_id) < 40:
        try:
            from crate import navidrome

            navidrome.unstar(item_id, item_type)
        except Exception:
            pass
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

    try:
        from crate.navidrome import set_navidrome_rating

        set_navidrome_rating(track_id, rating)
    except Exception:
        pass

    return {"ok": True, "rating": rating}


_TRACK_INFO_COLS = (
    "title, artist, album, bpm, audio_key, audio_scale, energy, "
    "danceability, valence, acousticness, instrumentalness, loudness, "
    "dynamic_range, lastfm_listeners, lastfm_playcount, popularity, rating"
)


@router.get("/api/tracks/{track_id}/info")
def api_track_info_by_id(request: Request, track_id: int):
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute(f"SELECT {_TRACK_INFO_COLS} FROM library_tracks WHERE id = %s", (track_id,))
        row = cur.fetchone()
    if not row:
        return Response(status_code=404)
    return dict(row)


@router.get("/api/track-info/{filepath:path}")
def api_track_info(request: Request, filepath: str):
    _require_auth(request)
    if filepath.startswith("/music/"):
        filepath = filepath[len("/music/") :]

    with get_db_ctx() as cur:
        cur.execute(
            f"SELECT {_TRACK_INFO_COLS} FROM library_tracks WHERE path LIKE %s LIMIT 1",
            (f"%{filepath}",),
        )
        row = cur.fetchone()

    if not row:
        return Response(status_code=404)
    return dict(row)


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
            f"""SELECT t.id, t.title, t.artist, a.name AS album, t.path, t.duration,
                       ar.id AS artist_id, ar.slug AS artist_slug,
                       a.id AS album_id, a.slug AS album_slug,
                       t.bpm, t.energy, t.danceability, t.valence, t.navidrome_id
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                LEFT JOIN library_artists ar ON ar.name = t.artist
                WHERE {' AND '.join(conditions)}
                ORDER BY RANDOM() LIMIT %s""",
            params,
        )
        tracks = [dict(r) for r in cur.fetchall()]
    return {"mood": mood, "filters": preset, "tracks": tracks, "count": len(tracks)}
