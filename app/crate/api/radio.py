from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from crate.api.auth import _require_auth
from crate.bliss import (
    generate_album_radio,
    generate_artist_radio,
    generate_playlist_radio,
    generate_track_radio,
)
from crate.db import get_db_ctx

router = APIRouter()


def _resolve_track_path(track_id: int = 0, path: str = "") -> str | None:
    if track_id:
        with get_db_ctx() as cur:
            cur.execute("SELECT path FROM library_tracks WHERE id = %s", (track_id,))
            row = cur.fetchone()
        return row["path"] if row else None

    if not path:
        return None

    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT path
            FROM library_tracks
            WHERE path = %s OR path LIKE %s
            ORDER BY CASE WHEN path = %s THEN 0 ELSE 1 END, path ASC
            LIMIT 1
            """,
            (path, f"%{path}", path),
        )
        row = cur.fetchone()
    return row["path"] if row else None


@router.get("/api/radio/artist/{name:path}")
def api_artist_radio(request: Request, name: str, limit: int = 50):
    _require_auth(request)
    tracks = generate_artist_radio(name, limit=limit)
    if not tracks:
        return JSONResponse({"error": "No radio data available yet"}, status_code=404)
    return {
        "session": {
            "type": "artist",
            "name": f"{name} Radio",
            "seed": {"artist_name": name},
        },
        "tracks": tracks,
    }


@router.get("/api/radio/track")
def api_track_radio(request: Request, track_id: int = 0, path: str = "", limit: int = 50):
    _require_auth(request)
    resolved_path = _resolve_track_path(track_id=track_id, path=path)
    if not resolved_path:
        raise HTTPException(status_code=404, detail="Track not found")

    tracks = generate_track_radio(resolved_path, limit=limit)
    if not tracks:
        return JSONResponse({"error": "No radio data available yet"}, status_code=404)

    seed_track = tracks[0]
    return {
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
        "tracks": tracks,
    }


@router.get("/api/radio/album/{album_id}")
def api_album_radio(request: Request, album_id: int, limit: int = 50):
    _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute("SELECT artist, name FROM library_albums WHERE id = %s", (album_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Album not found")

    tracks = generate_album_radio(album_id, limit=limit)
    if not tracks:
        return JSONResponse({"error": "No radio data available yet"}, status_code=404)

    return {
        "session": {
            "type": "album",
            "name": f"{row['name']} Radio",
            "seed": {
                "album_id": album_id,
                "artist": row["artist"],
                "album": row["name"],
            },
        },
        "tracks": tracks,
    }


@router.get("/api/radio/playlist/{playlist_id}")
def api_playlist_radio(request: Request, playlist_id: int, limit: int = 50):
    user = _require_auth(request)
    with get_db_ctx() as cur:
        cur.execute("SELECT id, name, scope, user_id, is_active FROM playlists WHERE id = %s", (playlist_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if row.get("scope") == "system" and not row.get("is_active", True):
        raise HTTPException(status_code=404, detail="Playlist not found")
    if row.get("scope") != "system" and row.get("user_id") != user["id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Not your playlist")

    tracks = generate_playlist_radio(playlist_id, limit=limit)
    if not tracks:
        return JSONResponse({"error": "No radio data available yet"}, status_code=404)

    return {
        "session": {
            "type": "playlist",
            "name": f"{row['name']} Radio",
            "seed": {
                "playlist_id": playlist_id,
                "name": row["name"],
            },
        },
        "tracks": tracks,
    }
