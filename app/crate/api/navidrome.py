import os
import logging

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from crate.api.auth import _require_auth
from crate.api._deps import artist_name_from_id, album_names_from_id
from crate import navidrome
from crate import playlists

log = logging.getLogger(__name__)
router = APIRouter()


def _domain() -> str:
    return os.environ.get("DOMAIN", "lespedants.org")


def _lookup_track_library_refs(cur, artist_name: str, album_name: str, title: str) -> dict:
    cur.execute(
        """
        SELECT
            t.id AS library_track_id,
            t.slug AS track_slug,
            a.id AS album_id,
            a.slug AS album_slug,
            ar.id AS artist_id,
            ar.slug AS artist_slug
        FROM library_tracks t
        JOIN library_albums a ON t.album_id = a.id
        LEFT JOIN library_artists ar ON ar.name = a.artist
        WHERE LOWER(a.artist) = LOWER(%s)
          AND LOWER(t.title) = LOWER(%s)
        ORDER BY CASE WHEN LOWER(a.name) = LOWER(%s) THEN 0 ELSE 1 END, a.year NULLS LAST, a.id ASC
        LIMIT 1
        """,
        (artist_name, title, album_name or ""),
    )
    return dict(cur.fetchone() or {})


@router.get("/api/navidrome/status")
def navidrome_status(request: Request):
    _require_auth(request)
    connected = navidrome.ping()
    version = navidrome.get_server_version() if connected else None
    return {"connected": connected, "version": version}


@router.get("/api/navidrome/search")
def navidrome_search(request: Request, q: str = Query("")):
    _require_auth(request)
    if len(q.strip()) < 2:
        return {"artist": [], "album": [], "song": []}
    try:
        return navidrome.search(q)
    except Exception as e:
        log.warning("Navidrome search failed: %s", e)
        return JSONResponse({"error": "Navidrome unavailable"}, status_code=502)


@router.get("/api/navidrome/stream/{song_id}")
def navidrome_stream(song_id: str, request: Request):
    _require_auth(request)
    try:
        # Forward Range header to Navidrome for seeking support
        extra_headers = {}
        range_header = request.headers.get("range")
        if range_header:
            extra_headers["Range"] = range_header

        import requests as http_requests
        url = f"{navidrome._base_url()}/rest/stream"
        params = {**navidrome._auth_params(), "id": song_id}
        resp = http_requests.get(
            url, params=params, timeout=30, stream=True,
            headers=extra_headers,
        )
        resp.raise_for_status()

        content_type = resp.headers.get("content-type", "audio/mpeg")
        status_code = resp.status_code  # 200 or 206 for partial content

        headers: dict[str, str] = {"Accept-Ranges": "bytes"}
        if "content-length" in resp.headers:
            headers["Content-Length"] = resp.headers["content-length"]
        if "content-range" in resp.headers:
            headers["Content-Range"] = resp.headers["content-range"]

        return StreamingResponse(
            resp.iter_content(chunk_size=8192),
            status_code=status_code,
            media_type=content_type,
            headers=headers,
        )
    except Exception as e:
        log.warning("Stream failed for %s: %s", song_id, e)
        return JSONResponse({"error": "Stream failed"}, status_code=502)


def navidrome_artist_link(request: Request, name: str):
    _require_auth(request)
    try:
        artist = navidrome.find_artist_by_name(name)
        if not artist:
            return JSONResponse({"error": "Artist not found in Navidrome"}, status_code=404)
        domain = _domain()
        return {
            "id": artist["id"],
            "name": artist.get("name", name),
            "navidrome_url": f"https://play.{domain}/app/#/artist/{artist['id']}/show",
        }
    except Exception as e:
        log.warning("Artist link failed for %s: %s", name, e)
        return JSONResponse({"error": "Navidrome unavailable"}, status_code=502)


@router.get("/api/navidrome/artists/{artist_id}/link")
def navidrome_artist_link_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    return navidrome_artist_link(request, artist_name)


def navidrome_top_tracks(request: Request, name: str, count: int = 20):
    _require_auth(request)
    # Try Navidrome first
    try:
        songs = navidrome.get_top_songs(name, count)
        if songs:
            from crate.db import get_db_ctx

            results = []
            with get_db_ctx() as cur:
                for s in songs:
                    refs = _lookup_track_library_refs(
                        cur,
                        s.get("artist", name),
                        s.get("album", ""),
                        s.get("title", ""),
                    )
                    results.append({
                        "id": s["id"],
                        "title": s.get("title", ""),
                        "artist": s.get("artist", name),
                        "artist_id": refs.get("artist_id"),
                        "artist_slug": refs.get("artist_slug"),
                        "album": s.get("album", ""),
                        "album_id": refs.get("album_id"),
                        "album_slug": refs.get("album_slug"),
                        "duration": s.get("duration", 0),
                        "track": s.get("track", 0),
                    })
            return results
    except Exception as e:
        log.debug("Navidrome top tracks failed for %s: %s", name, e)

    # Fallback: Last.fm top tracks matched to local library
    try:
        from crate.lastfm import get_top_tracks as lastfm_top
        from crate.db import get_db_ctx
        lastfm_tracks = lastfm_top(name, limit=count)
        if not lastfm_tracks:
            return []

        # Match Last.fm tracks to local library paths for playback
        results = []
        with get_db_ctx() as cur:
            for lt in lastfm_tracks:
                # Try exact match first, then prefix match (handles "Song (Album Version)" etc.)
                cur.execute(
                    "SELECT t.path, t.title, t.artist, t.duration, a.name AS album, "
                    "a.id AS album_id, a.slug AS album_slug, ar.id AS artist_id, ar.slug AS artist_slug "
                    "FROM library_tracks t JOIN library_albums a ON t.album_id = a.id "
                    "LEFT JOIN library_artists ar ON ar.name = a.artist "
                    "WHERE LOWER(t.artist) = LOWER(%s) AND ("
                    "  LOWER(t.title) = LOWER(%s) OR LOWER(t.title) LIKE LOWER(%s) || '%%'"
                    ") LIMIT 1",
                    (name, lt["title"], lt["title"]),
                )
                row = cur.fetchone()
                if row:
                    # Make path relative to library root for /api/stream/
                    track_path = row["path"]
                    if track_path.startswith("/music/"):
                        track_path = track_path[len("/music/"):]
                    results.append({
                        "id": track_path,
                        "title": row["title"],
                        "artist": row["artist"],
                        "artist_id": row.get("artist_id"),
                        "artist_slug": row.get("artist_slug"),
                        "album": row["album"],
                        "album_id": row.get("album_id"),
                        "album_slug": row.get("album_slug"),
                        "duration": int(row["duration"] or 0),
                        "track": 0,
                        "listeners": lt.get("listeners", 0),
                    })
        return results
    except Exception as e:
        log.debug("Last.fm top tracks fallback failed for %s: %s", name, e)
        return []


@router.get("/api/navidrome/artists/{artist_id}/top-tracks")
def navidrome_top_tracks_by_id(request: Request, artist_id: int, count: int = 20):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    return navidrome_top_tracks(request, artist_name, count)


def navidrome_album_link(request: Request, artist: str, album: str):
    _require_auth(request)
    try:
        # Get tag_album and MBID from our DB for better matching
        from crate.db import get_library_album
        db_album = get_library_album(artist, album)
        tag_album = db_album.get("tag_album") if db_album else None
        mbid = db_album.get("musicbrainz_albumid") if db_album else None
        found = navidrome.find_album(artist, album, tag_album=tag_album, mbid=mbid)
        if not found:
            return JSONResponse({"error": "Album not found in Navidrome"}, status_code=404)
        full = navidrome.get_album(found["id"])
        domain = _domain()
        songs = [
            {
                "id": s["id"],
                "title": s.get("title", ""),
                "track": s.get("track", 0),
                "duration": s.get("duration", 0),
            }
            for s in full.get("song", [])
        ]
        return {
            "id": full["id"],
            "name": full.get("name", album),
            "songs": songs,
            "navidrome_url": f"https://play.{domain}/app/#/album/{full['id']}",
        }
    except Exception as e:
        log.warning("Album link failed for %s/%s: %s", artist, album, e)
        return JSONResponse({"error": "Navidrome unavailable"}, status_code=502)


@router.get("/api/navidrome/albums/{album_id}/link")
def navidrome_album_link_by_id(request: Request, album_id: int):
    album_names = album_names_from_id(album_id)
    if not album_names:
        return JSONResponse({"error": "Album not found"}, status_code=404)
    artist, album = album_names
    return navidrome_album_link(request, artist, album)


@router.get("/api/navidrome/playlists")
def navidrome_playlists(request: Request):
    _require_auth(request)
    try:
        return {"playlists": navidrome.get_playlists()}
    except Exception as e:
        log.warning("Playlists fetch failed: %s", e)
        return JSONResponse({"error": "Navidrome unavailable"}, status_code=502)


@router.post("/api/navidrome/playlists")
def navidrome_create_playlist(request: Request, body: dict):
    _require_auth(request)
    name = body.get("name", "").strip()
    song_ids = body.get("song_ids", [])
    if not name:
        return JSONResponse({"error": "Name required"}, status_code=400)
    if not song_ids:
        return JSONResponse({"error": "song_ids required"}, status_code=400)
    try:
        playlist_id = navidrome.create_playlist(name, song_ids)
        return {"id": playlist_id, "name": name}
    except Exception as e:
        log.warning("Playlist creation failed: %s", e)
        return JSONResponse({"error": "Failed to create playlist"}, status_code=502)


@router.delete("/api/navidrome/playlists/{playlist_id}")
def navidrome_delete_playlist(request: Request, playlist_id: str):
    _require_auth(request)
    try:
        navidrome.delete_playlist(playlist_id)
        return {"ok": True}
    except Exception as e:
        log.warning("Playlist delete failed: %s", e)
        return JSONResponse({"error": "Failed to delete playlist"}, status_code=502)


@router.post("/api/navidrome/map-ids")
def api_map_navidrome_ids(request: Request):
    """Bulk map local library to Navidrome IDs."""
    _require_auth(request)
    from crate.db import create_task
    task_id = create_task("map_navidrome_ids")
    return {"task_id": task_id}


@router.post("/api/navidrome/star")
def api_star(request: Request, body: dict):
    """Star/favorite an item in Navidrome."""
    _require_auth(request)
    item_id = body.get("navidrome_id", "")
    item_type = body.get("type", "song")
    if not item_id:
        return JSONResponse({"error": "navidrome_id required"}, status_code=400)
    if item_type not in ("song", "album", "artist"):
        return JSONResponse({"error": "type must be song, album, or artist"}, status_code=400)
    ok = navidrome.star(item_id, item_type)
    if ok:
        from crate.db import get_db_ctx
        from datetime import datetime, timezone
        with get_db_ctx() as cur:
            cur.execute(
                "INSERT INTO favorites (item_type, item_id, navidrome_id, created_at) VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
                (item_type, body.get("local_id", item_id), item_id, datetime.now(timezone.utc).isoformat()),
            )
    return {"ok": ok}


@router.post("/api/navidrome/unstar")
def api_unstar(request: Request, body: dict):
    """Remove star from an item."""
    _require_auth(request)
    item_id = body.get("navidrome_id", "")
    item_type = body.get("type", "song")
    if not item_id:
        return JSONResponse({"error": "navidrome_id required"}, status_code=400)
    if item_type not in ("song", "album", "artist"):
        return JSONResponse({"error": "type must be song, album, or artist"}, status_code=400)
    ok = navidrome.unstar(item_id, item_type)
    if ok:
        from crate.db import get_db_ctx
        with get_db_ctx() as cur:
            cur.execute("DELETE FROM favorites WHERE navidrome_id = %s AND item_type = %s", (item_id, item_type))
    return {"ok": ok}


@router.get("/api/navidrome/favorites")
def api_favorites(request: Request):
    """Get all favorites from Navidrome."""
    _require_auth(request)
    return navidrome.get_starred()


@router.post("/api/navidrome/scrobble")
def api_scrobble(request: Request, body: dict):
    """Scrobble a track (report as played)."""
    _require_auth(request)
    song_id = body.get("navidrome_id", "")
    if not song_id:
        return JSONResponse({"error": "navidrome_id required"}, status_code=400)
    ok = navidrome.scrobble(song_id)
    return {"ok": ok}


@router.get("/api/navidrome/recently-played")
def api_recently_played(request: Request):
    """Get recently played albums from Navidrome."""
    _require_auth(request)
    return navidrome.get_album_list("recent", size=20)


@router.get("/api/navidrome/most-played")
def api_most_played(request: Request):
    """Get most played albums from Navidrome."""
    _require_auth(request)
    return navidrome.get_album_list("frequent", size=20)


@router.post("/api/navidrome/playlists/smart")
def navidrome_smart_playlist(request: Request, body: dict):
    _require_auth(request)
    strategy = body.get("strategy", "random")
    name = body.get("name", "").strip()
    limit = body.get("limit", 50)
    param = body.get("param", "")

    if not name:
        return JSONResponse({"error": "Name required"}, status_code=400)

    try:
        if strategy == "genre":
            song_ids = playlists.generate_by_genre(param, limit)
        elif strategy == "decade":
            song_ids = playlists.generate_by_decade(int(param), limit)
        elif strategy == "artist":
            song_ids = playlists.generate_by_artist(param, limit)
        elif strategy == "similar":
            song_ids = playlists.generate_similar_artists(param, limit)
        else:
            song_ids = playlists.generate_random(limit)

        if not song_ids:
            return JSONResponse({"error": "No songs found for criteria"}, status_code=404)

        playlist_id = navidrome.create_playlist(name, song_ids)
        return {"id": playlist_id, "name": name, "song_count": len(song_ids)}
    except Exception as e:
        log.warning("Smart playlist failed: %s", e)
        return JSONResponse({"error": f"Failed: {e}"}, status_code=502)
