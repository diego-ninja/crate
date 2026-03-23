import os
import logging

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from musicdock import navidrome
from musicdock import playlists

log = logging.getLogger(__name__)
router = APIRouter()


def _domain() -> str:
    return os.environ.get("DOMAIN", "lespedants.org")


@router.get("/api/navidrome/status")
def navidrome_status():
    connected = navidrome.ping()
    version = navidrome.get_server_version() if connected else None
    return {"connected": connected, "version": version}


@router.get("/api/navidrome/search")
def navidrome_search(q: str = Query("")):
    if len(q.strip()) < 2:
        return {"artist": [], "album": [], "song": []}
    try:
        return navidrome.search(q)
    except Exception as e:
        log.warning("Navidrome search failed: %s", e)
        return JSONResponse({"error": "Navidrome unavailable"}, status_code=502)


@router.get("/api/navidrome/stream/{song_id}")
def navidrome_stream(song_id: str, request: Request):
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


@router.get("/api/navidrome/artist/{name}/link")
def navidrome_artist_link(name: str):
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


@router.get("/api/navidrome/artist/{name}/top-tracks")
def navidrome_top_tracks(name: str, count: int = 20):
    # Try Navidrome first
    try:
        songs = navidrome.get_top_songs(name, count)
        if songs:
            return [
                {
                    "id": s["id"],
                    "title": s.get("title", ""),
                    "artist": s.get("artist", name),
                    "album": s.get("album", ""),
                    "duration": s.get("duration", 0),
                    "track": s.get("track", 0),
                }
                for s in songs
            ]
    except Exception as e:
        log.debug("Navidrome top tracks failed for %s: %s", name, e)

    # Fallback: Last.fm top tracks matched to local library
    try:
        from musicdock.lastfm import get_top_tracks as lastfm_top
        from musicdock.db import get_db_ctx
        lastfm_tracks = lastfm_top(name, limit=count)
        if not lastfm_tracks:
            return []

        # Match Last.fm tracks to local library paths for playback
        results = []
        with get_db_ctx() as cur:
            for lt in lastfm_tracks:
                # Try exact match first, then prefix match (handles "Song (Album Version)" etc.)
                cur.execute(
                    "SELECT t.path, t.title, t.artist, t.duration, a.name AS album "
                    "FROM library_tracks t JOIN library_albums a ON t.album_id = a.id "
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
                        "album": row["album"],
                        "duration": int(row["duration"] or 0),
                        "track": 0,
                        "listeners": lt.get("listeners", 0),
                    })
        return results
    except Exception as e:
        log.debug("Last.fm top tracks fallback failed for %s: %s", name, e)
        return []


@router.get("/api/navidrome/album/{artist}/{album}/link")
def navidrome_album_link(artist: str, album: str):
    try:
        # Get tag_album and MBID from our DB for better matching
        from musicdock.db import get_library_album
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


@router.get("/api/navidrome/playlists")
def navidrome_playlists():
    try:
        return {"playlists": navidrome.get_playlists()}
    except Exception as e:
        log.warning("Playlists fetch failed: %s", e)
        return JSONResponse({"error": "Navidrome unavailable"}, status_code=502)


@router.post("/api/navidrome/playlists")
def navidrome_create_playlist(body: dict):
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
def navidrome_delete_playlist(playlist_id: str):
    try:
        navidrome.delete_playlist(playlist_id)
        return {"ok": True}
    except Exception as e:
        log.warning("Playlist delete failed: %s", e)
        return JSONResponse({"error": "Failed to delete playlist"}, status_code=502)


@router.post("/api/navidrome/playlists/smart")
def navidrome_smart_playlist(body: dict):
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
