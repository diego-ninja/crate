from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from crate.api.auth import _require_auth
from crate.api._deps import artist_name_from_id, enrich_radio_tracks as _enrich_radio_tracks
from crate.db import get_cache, set_cache
from crate.bliss import (
    generate_album_radio,
    generate_artist_radio,
    generate_playlist_radio,
    generate_track_radio,
)
from crate.db import get_db_ctx, get_user_by_email

router = APIRouter()


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _effective_user_id(user: dict) -> int | None:
    if user.get("id") is not None:
        return user["id"]
    email = user.get("email")
    if not email:
        return None
    existing = get_user_by_email(email)
    return existing["id"] if existing else None


def _resolve_track_path(track_id: int = 0, path: str = "") -> str | None:
    if track_id:
        with get_db_ctx() as cur:
            cur.execute("SELECT path FROM library_tracks WHERE id = %s", (track_id,))
            row = cur.fetchone()
        return row["path"] if row else None

    if not path:
        return None

    with get_db_ctx() as cur:
        escaped_path = _escape_like(path)
        cur.execute(
            """
            SELECT path
            FROM library_tracks
            WHERE path = %s OR path LIKE %s ESCAPE '\\'
            ORDER BY CASE WHEN path = %s THEN 0 ELSE 1 END, path ASC
            LIMIT 1
            """,
            (path, f"%{escaped_path}", path),
        )
        row = cur.fetchone()
    return row["path"] if row else None


_RADIO_CACHE_TTL = 300  # 5 minutes


def api_artist_radio(request: Request, name: str, limit: int = Query(50, ge=1, le=100)):
    _require_auth(request)
    cache_key = f"radio:artist:{name.lower()}:{limit}"
    cached = get_cache(cache_key, max_age_seconds=_RADIO_CACHE_TTL)
    if cached:
        return cached

    tracks = generate_artist_radio(name, limit=limit)
    if not tracks:
        return JSONResponse({"error": "No radio data available yet"}, status_code=404)
    enriched_tracks = _enrich_radio_tracks(tracks)
    result = {
        "session": {
            "type": "artist",
            "name": f"{name} Radio",
            "seed": {"artist_id": None, "artist_name": name},
        },
        "tracks": enriched_tracks,
    }
    set_cache(cache_key, result, ttl=_RADIO_CACHE_TTL)
    return result


@router.get("/api/artists/{artist_id}/radio")
def api_artist_radio_by_id(request: Request, artist_id: int, limit: int = Query(50, ge=1, le=100)):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        raise HTTPException(status_code=404, detail="Artist not found")
    result = api_artist_radio(request, artist_name, limit)
    if isinstance(result, dict):
        session = dict(result.get("session") or {})
        seed = dict(session.get("seed") or {})
        seed["artist_id"] = artist_id
        session["seed"] = seed
        result["session"] = session
    return result


@router.get("/api/radio/track")
def api_track_radio(
    request: Request,
    track_id: int = 0,
    path: str = "",
    limit: int = Query(50, ge=1, le=100),
):
    _require_auth(request)
    resolved_path = _resolve_track_path(track_id=track_id, path=path)
    if not resolved_path:
        raise HTTPException(status_code=404, detail="Track not found")

    cache_key = f"radio:track:{resolved_path}:{limit}"
    cached = get_cache(cache_key, max_age_seconds=_RADIO_CACHE_TTL)
    if cached:
        return cached

    tracks = generate_track_radio(resolved_path, limit=limit)
    if not tracks:
        return JSONResponse({"error": "No radio data available yet"}, status_code=404)

    enriched_tracks = _enrich_radio_tracks(tracks)
    seed_track = enriched_tracks[0]
    result = {
        "session": {
            "type": "track",
            "name": f"{seed_track.get('title') or 'Track'} Radio",
            "seed": {
                "track_id": seed_track.get("track_id"),
                "track_path": seed_track.get("track_path"),
                "title": seed_track.get("title"),
                "artist": seed_track.get("artist"),
            },
        },
        "tracks": enriched_tracks,
    }
    set_cache(cache_key, result, ttl=_RADIO_CACHE_TTL)
    return result


@router.get("/api/radio/album/{album_id}")
def api_album_radio(request: Request, album_id: int, limit: int = Query(50, ge=1, le=100)):
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute("SELECT artist, name FROM library_albums WHERE id = %s", (album_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Album not found")

    cache_key = f"radio:album:{album_id}:{limit}"
    cached = get_cache(cache_key, max_age_seconds=_RADIO_CACHE_TTL)
    if cached:
        return cached

    tracks = generate_album_radio(album_id, limit=limit)
    if not tracks:
        return JSONResponse({"error": "No radio data available yet"}, status_code=404)

    enriched_tracks = _enrich_radio_tracks(tracks)
    result = {
        "session": {
            "type": "album",
            "name": f"{row['name']} Radio",
            "seed": {
                "album_id": album_id,
                "artist": row["artist"],
                "album": row["name"],
            },
        },
        "tracks": enriched_tracks,
    }
    set_cache(cache_key, result, ttl=_RADIO_CACHE_TTL)
    return result


@router.get("/api/radio/playlist/{playlist_id}")
def api_playlist_radio(request: Request, playlist_id: int, limit: int = Query(50, ge=1, le=100)):
    user = _require_auth(request)
    effective_user_id = _effective_user_id(user)
    with get_db_ctx() as cur:
        cur.execute("SELECT id, name, scope, user_id, is_active FROM playlists WHERE id = %s", (playlist_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if row.get("scope") == "system" and not row.get("is_active", False):
        raise HTTPException(status_code=404, detail="Playlist not found")
    if (
        row.get("scope") != "system"
        and row.get("user_id") != effective_user_id
        and user.get("role") != "admin"
    ):
        raise HTTPException(status_code=403, detail="Not your playlist")

    cache_key = f"radio:playlist:{playlist_id}:{limit}"
    cached = get_cache(cache_key, max_age_seconds=_RADIO_CACHE_TTL)
    if cached:
        return cached

    tracks = generate_playlist_radio(playlist_id, limit=limit)
    if not tracks:
        return JSONResponse({"error": "No radio data available yet"}, status_code=404)

    enriched_tracks = _enrich_radio_tracks(tracks)
    result = {
        "session": {
            "type": "playlist",
            "name": f"{row['name']} Radio",
            "seed": {
                "playlist_id": playlist_id,
                "name": row["name"],
            },
        },
        "tracks": enriched_tracks,
    }
    set_cache(cache_key, result, ttl=_RADIO_CACHE_TTL)
    return result
