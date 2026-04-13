"""Subsonic API compatible endpoints.

Allows third-party music players (Symfonium, DSub, play:Sub, Ultrasonic, etc.)
to browse, search, and stream from the Crate library.

Spec: http://www.subsonic.org/pages/api.jsp
"""

import hashlib
import hmac
import logging
from pathlib import Path

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import JSONResponse

from crate.db import get_db_ctx, get_user_by_email
from crate.auth import verify_password
from crate.api._deps import library_path

log = logging.getLogger(__name__)
router = APIRouter(prefix="/rest", tags=["subsonic"])

SUBSONIC_API_VERSION = "1.16.1"
SERVER_NAME = "Crate"


# ── Auth ────────────────────────────────────────────────────────

def _subsonic_auth(request: Request) -> dict | None:
    """Authenticate via Subsonic token auth (md5(password + salt)) or plain password."""
    params = request.query_params
    username = params.get("u", "")
    token = params.get("t", "")
    salt = params.get("s", "")
    password = params.get("p", "")

    if not username:
        return None

    user = get_user_by_email(username)
    if not user:
        # Try username field too
        with get_db_ctx() as cur:
            cur.execute("SELECT * FROM users WHERE username = %s", (username,))
            row = cur.fetchone()
            if row:
                user = dict(row)

    if not user or not user.get("password_hash"):
        return None

    if token and salt:
        # Token auth: client sends md5(password + salt)
        # We need to check against stored password — but we only have bcrypt hash.
        # Subsonic token auth is incompatible with bcrypt. Fall back to checking
        # if the user has a plain-text compatible token stored, or reject.
        # For now: store a subsonic_token on the user for compatibility.
        stored_token = user.get("subsonic_token")
        if stored_token:
            expected = hashlib.md5((stored_token + salt).encode()).hexdigest()
            if hmac.compare_digest(token, expected):
                return user
        return None
    elif password:
        # Plain password (deprecated but simpler)
        pw = password
        if pw.startswith("enc:"):
            try:
                pw = bytes.fromhex(pw[4:]).decode("utf-8")
            except (ValueError, UnicodeDecodeError):
                return None
        if verify_password(pw, user["password_hash"]):
            return user

    return None


def _subsonic_response(data: dict, status: str = "ok") -> JSONResponse:
    """Wrap response in Subsonic format."""
    return JSONResponse({
        "subsonic-response": {
            "status": status,
            "version": SUBSONIC_API_VERSION,
            "type": SERVER_NAME,
            "serverVersion": "0.1.0",
            **data,
        }
    })


def _subsonic_error(code: int, message: str) -> JSONResponse:
    return _subsonic_response({"error": {"code": code, "message": message}}, status="failed")


def _require_subsonic_auth(request: Request) -> dict:
    user = _subsonic_auth(request)
    if not user:
        raise SubsonicAuthError()
    return user


class SubsonicAuthError(Exception):
    pass


# ── System ──────────────────────────────────────────────────────

@router.get("/ping")
@router.get("/ping.view")
def ping(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")
    return _subsonic_response({})


@router.get("/getLicense")
@router.get("/getLicense.view")
def get_license(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")
    return _subsonic_response({
        "license": {"valid": True, "email": "crate@local", "licenseExpires": "2099-12-31T00:00:00"}
    })


@router.get("/getMusicFolders")
@router.get("/getMusicFolders.view")
def get_music_folders(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")
    return _subsonic_response({
        "musicFolders": {"musicFolder": [{"id": 1, "name": "Music"}]}
    })


@router.get("/getUser")
@router.get("/getUser.view")
def get_user(request: Request, username: str = Query("")):
    try:
        user = _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")
    return _subsonic_response({
        "user": {
            "username": user.get("username") or user["email"],
            "email": user["email"],
            "adminRole": user["role"] == "admin",
            "scrobblingEnabled": True,
            "settingsRole": True,
            "downloadRole": True,
            "uploadRole": False,
            "playlistRole": True,
            "coverArtRole": True,
            "commentRole": False,
            "podcastRole": False,
            "streamRole": True,
            "jukeboxRole": False,
            "shareRole": True,
        }
    })


# ── Browse ──────────────────────────────────────────────────────

@router.get("/getArtists")
@router.get("/getArtists.view")
def get_artists(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    with get_db_ctx() as cur:
        cur.execute("""
            SELECT id, name, album_count, COALESCE(listeners, 0) as listeners
            FROM library_artists
            ORDER BY name
        """)
        rows = cur.fetchall()

    # Group by first letter
    index_map: dict[str, list] = {}
    for row in rows:
        letter = (row["name"][0] or "?").upper()
        if not letter.isalpha():
            letter = "#"
        index_map.setdefault(letter, []).append({
            "id": f"ar-{row['id']}",
            "name": row["name"],
            "albumCount": row["album_count"] or 0,
        })

    indexes = [{"name": letter, "artist": artists} for letter, artists in sorted(index_map.items())]

    return _subsonic_response({
        "artists": {"ignoredArticles": "The El La Los Las", "index": indexes}
    })


@router.get("/getArtist")
@router.get("/getArtist.view")
def get_artist(request: Request, id: str = Query("")):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    artist_id = int(id.replace("ar-", "")) if id.startswith("ar-") else int(id)

    with get_db_ctx() as cur:
        cur.execute("SELECT id, name FROM library_artists WHERE id = %s", (artist_id,))
        artist = cur.fetchone()
        if not artist:
            return _subsonic_error(70, "Artist not found")

        cur.execute("""
            SELECT id, name, year, track_count, has_cover,
                   COALESCE(total_duration, 0) as duration
            FROM library_albums
            WHERE artist = %s
            ORDER BY year DESC NULLS LAST, name
        """, (artist["name"],))
        albums = cur.fetchall()

    return _subsonic_response({
        "artist": {
            "id": f"ar-{artist['id']}",
            "name": artist["name"],
            "albumCount": len(albums),
            "album": [{
                "id": f"al-{a['id']}",
                "name": a["name"],
                "artist": artist["name"],
                "artistId": f"ar-{artist['id']}",
                "year": int(a["year"]) if a["year"] else None,
                "songCount": a["track_count"] or 0,
                "duration": a["duration"],
                "coverArt": f"al-{a['id']}" if a["has_cover"] else None,
            } for a in albums],
        }
    })


@router.get("/getAlbum")
@router.get("/getAlbum.view")
def get_album(request: Request, id: str = Query("")):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    album_id = int(id.replace("al-", "")) if id.startswith("al-") else int(id)

    with get_db_ctx() as cur:
        cur.execute("""
            SELECT a.id, a.name, a.artist, a.year, a.track_count, a.has_cover,
                   COALESCE(a.total_duration, 0) as duration,
                   ar.id as artist_id
            FROM library_albums a
            LEFT JOIN library_artists ar ON ar.name = a.artist
            WHERE a.id = %s
        """, (album_id,))
        album = cur.fetchone()
        if not album:
            return _subsonic_error(70, "Album not found")

        cur.execute("""
            SELECT id, title, artist, album, path, duration,
                   COALESCE(track_number, 0) as track,
                   COALESCE(disc_number, 1) as disc,
                   format, bitrate, sample_rate
            FROM library_tracks
            WHERE album_id = %s
            ORDER BY disc_number, track_number
        """, (album_id,))
        tracks = cur.fetchall()

    return _subsonic_response({
        "album": {
            "id": f"al-{album['id']}",
            "name": album["name"],
            "artist": album["artist"],
            "artistId": f"ar-{album['artist_id']}" if album["artist_id"] else None,
            "year": int(album["year"]) if album["year"] else None,
            "songCount": len(tracks),
            "duration": album["duration"],
            "coverArt": f"al-{album['id']}" if album["has_cover"] else None,
            "song": [{
                "id": str(t["id"]),
                "title": t["title"],
                "artist": t["artist"],
                "album": t["album"],
                "albumId": f"al-{album['id']}",
                "artistId": f"ar-{album['artist_id']}" if album["artist_id"] else None,
                "track": t["track"],
                "discNumber": t["disc"],
                "year": int(album["year"]) if album["year"] else None,
                "duration": t["duration"] or 0,
                "bitRate": t["bitrate"] or 0,
                "suffix": (t["format"] or "mp3").lower(),
                "contentType": _content_type(t["format"]),
                "path": t["path"],
                "coverArt": f"al-{album['id']}" if album["has_cover"] else None,
                "type": "music",
            } for t in tracks],
        }
    })


@router.get("/getSong")
@router.get("/getSong.view")
def get_song(request: Request, id: str = Query("")):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    track_id = int(id)
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT t.id, t.title, t.artist, t.album, t.path, t.duration,
                   t.track_number, t.disc_number, t.format, t.bitrate,
                   a.id as album_id, a.has_cover, a.year,
                   ar.id as artist_id
            FROM library_tracks t
            LEFT JOIN library_albums a ON a.id = t.album_id
            LEFT JOIN library_artists ar ON ar.name = t.artist
            WHERE t.id = %s
        """, (track_id,))
        t = cur.fetchone()
        if not t:
            return _subsonic_error(70, "Song not found")

    return _subsonic_response({
        "song": {
            "id": str(t["id"]),
            "title": t["title"],
            "artist": t["artist"],
            "album": t["album"],
            "albumId": f"al-{t['album_id']}" if t["album_id"] else None,
            "artistId": f"ar-{t['artist_id']}" if t["artist_id"] else None,
            "track": t["track_number"] or 0,
            "discNumber": t["disc_number"] or 1,
            "year": int(t["year"]) if t["year"] else None,
            "duration": t["duration"] or 0,
            "bitRate": t["bitrate"] or 0,
            "suffix": (t["format"] or "mp3").lower(),
            "contentType": _content_type(t["format"]),
            "path": t["path"],
            "coverArt": f"al-{t['album_id']}" if t["album_id"] and t["has_cover"] else None,
            "type": "music",
        }
    })


# ── Album Lists ─────────────────────────────────────────────────

@router.get("/getAlbumList2")
@router.get("/getAlbumList2.view")
def get_album_list2(
    request: Request,
    type: str = Query("alphabeticalByName"),
    size: int = Query(10),
    offset: int = Query(0),
):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    order_map = {
        "alphabeticalByName": "a.name ASC",
        "alphabeticalByArtist": "a.artist ASC, a.name ASC",
        "newest": "COALESCE(a.year, '0') DESC, a.name ASC",
        "recent": "a.updated_at DESC",
        "frequent": "a.play_count DESC NULLS LAST",
        "random": "RANDOM()",
    }
    order = order_map.get(type, "a.name ASC")

    with get_db_ctx() as cur:
        cur.execute(f"""
            SELECT a.id, a.name, a.artist, a.year, a.track_count, a.has_cover,
                   COALESCE(a.total_duration, 0) as duration,
                   ar.id as artist_id
            FROM library_albums a
            LEFT JOIN library_artists ar ON ar.name = a.artist
            ORDER BY {order}
            LIMIT %s OFFSET %s
        """, (size, offset))
        albums = cur.fetchall()

    return _subsonic_response({
        "albumList2": {
            "album": [{
                "id": f"al-{a['id']}",
                "name": a["name"],
                "artist": a["artist"],
                "artistId": f"ar-{a['artist_id']}" if a["artist_id"] else None,
                "year": int(a["year"]) if a["year"] else None,
                "songCount": a["track_count"] or 0,
                "duration": a["duration"],
                "coverArt": f"al-{a['id']}" if a["has_cover"] else None,
            } for a in albums],
        }
    })


# ── Search ──────────────────────────────────────────────────────

@router.get("/search3")
@router.get("/search3.view")
def search3(
    request: Request,
    query: str = Query("", alias="query"),
    artistCount: int = Query(5),
    albumCount: int = Query(5),
    songCount: int = Query(10),
):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    q = f"%{query}%"
    result: dict = {"artist": [], "album": [], "song": []}

    with get_db_ctx() as cur:
        cur.execute("SELECT id, name FROM library_artists WHERE name ILIKE %s LIMIT %s", (q, artistCount))
        result["artist"] = [{"id": f"ar-{r['id']}", "name": r["name"]} for r in cur.fetchall()]

        cur.execute("""
            SELECT a.id, a.name, a.artist, a.year, a.has_cover, ar.id as artist_id
            FROM library_albums a
            LEFT JOIN library_artists ar ON ar.name = a.artist
            WHERE a.name ILIKE %s
            LIMIT %s
        """, (q, albumCount))
        result["album"] = [{
            "id": f"al-{r['id']}", "name": r["name"], "artist": r["artist"],
            "artistId": f"ar-{r['artist_id']}" if r["artist_id"] else None,
            "year": int(r["year"]) if r["year"] else None,
            "coverArt": f"al-{r['id']}" if r["has_cover"] else None,
        } for r in cur.fetchall()]

        cur.execute("""
            SELECT t.id, t.title, t.artist, t.album, t.duration, t.path,
                   t.format, t.bitrate, a.id as album_id, a.has_cover, ar.id as artist_id
            FROM library_tracks t
            LEFT JOIN library_albums a ON a.id = t.album_id
            LEFT JOIN library_artists ar ON ar.name = t.artist
            WHERE t.title ILIKE %s OR t.artist ILIKE %s
            LIMIT %s
        """, (q, q, songCount))
        result["song"] = [{
            "id": str(r["id"]), "title": r["title"], "artist": r["artist"],
            "album": r["album"], "duration": r["duration"] or 0,
            "albumId": f"al-{r['album_id']}" if r["album_id"] else None,
            "artistId": f"ar-{r['artist_id']}" if r["artist_id"] else None,
            "coverArt": f"al-{r['album_id']}" if r["album_id"] and r["has_cover"] else None,
            "suffix": (r["format"] or "mp3").lower(),
            "contentType": _content_type(r["format"]),
            "type": "music",
        } for r in cur.fetchall()]

    return _subsonic_response({"searchResult3": result})


# ── Stream & Cover Art ──────────────────────────────────────────

@router.get("/stream")
@router.get("/stream.view")
def stream(request: Request, id: str = Query("")):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    track_id = int(id)
    with get_db_ctx() as cur:
        cur.execute("SELECT path, format FROM library_tracks WHERE id = %s", (track_id,))
        track = cur.fetchone()
        if not track:
            return Response(status_code=404)

    from fastapi.responses import FileResponse

    lib = library_path()
    filepath = Path(track["path"])
    if not filepath.is_absolute():
        filepath = lib / filepath
    # Prevent path traversal
    if not filepath.resolve().is_relative_to(lib.resolve()):
        return Response(status_code=403)
    if not filepath.is_file():
        return Response(status_code=404)

    media_type = _content_type(track["format"])
    return FileResponse(
        path=str(filepath),
        media_type=media_type,
        headers={
            "Cache-Control": "public, max-age=86400",
        },
    )


@router.get("/getCoverArt")
@router.get("/getCoverArt.view")
def get_cover_art(request: Request, id: str = Query("")):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    if id.startswith("al-"):
        album_id = int(id[3:])
        from crate.api.browse_album import api_cover_by_id
        return api_cover_by_id(album_id)
    elif id.startswith("ar-"):
        artist_id = int(id[3:])
        from crate.api.browse_artist import api_artist_photo_by_id
        return api_artist_photo_by_id(request, artist_id)

    return Response(status_code=404)


# ── Scrobble ────────────────────────────────────────────────────

@router.get("/scrobble")
@router.get("/scrobble.view")
@router.post("/scrobble")
@router.post("/scrobble.view")
def scrobble(request: Request, id: str = Query(""), submission: str = Query("true")):
    try:
        user = _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    if submission != "true":
        return _subsonic_response({})

    track_id = int(id)
    with get_db_ctx() as cur:
        cur.execute("SELECT title, artist, album FROM library_tracks WHERE id = %s", (track_id,))
        track = cur.fetchone()

    if track:
        from crate.db.user_library import record_play
        record_play(user["id"], track_id=track_id, title=track["title"], artist=track["artist"], album=track["album"])

    return _subsonic_response({})


# ── Stubs (required by clients but not critical) ────────────────

@router.get("/getPlaylists")
@router.get("/getPlaylists.view")
def get_playlists(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")
    return _subsonic_response({"playlists": {"playlist": []}})


@router.get("/getStarred2")
@router.get("/getStarred2.view")
def get_starred2(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")
    return _subsonic_response({"starred2": {"artist": [], "album": [], "song": []}})


@router.get("/getRandomSongs")
@router.get("/getRandomSongs.view")
def get_random_songs(request: Request, size: int = Query(10)):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    with get_db_ctx() as cur:
        cur.execute("""
            SELECT t.id, t.title, t.artist, t.album, t.duration, t.path,
                   t.format, t.bitrate, t.track_number, t.disc_number,
                   a.id as album_id, a.has_cover, a.year, ar.id as artist_id
            FROM library_tracks t
            LEFT JOIN library_albums a ON a.id = t.album_id
            LEFT JOIN library_artists ar ON ar.name = t.artist
            ORDER BY RANDOM()
            LIMIT %s
        """, (size,))
        tracks = cur.fetchall()

    return _subsonic_response({
        "randomSongs": {
            "song": [{
                "id": str(t["id"]),
                "title": t["title"],
                "artist": t["artist"],
                "album": t["album"],
                "albumId": f"al-{t['album_id']}" if t["album_id"] else None,
                "artistId": f"ar-{t['artist_id']}" if t["artist_id"] else None,
                "duration": t["duration"] or 0,
                "bitRate": t["bitrate"] or 0,
                "suffix": (t["format"] or "mp3").lower(),
                "contentType": _content_type(t["format"]),
                "coverArt": f"al-{t['album_id']}" if t["album_id"] and t["has_cover"] else None,
                "type": "music",
            } for t in tracks],
        }
    })


# ── Helpers ─────────────────────────────────────────────────────

def _content_type(fmt: str | None) -> str:
    m = {
        "flac": "audio/flac",
        "mp3": "audio/mpeg",
        "ogg": "audio/ogg",
        "m4a": "audio/mp4",
        "aac": "audio/aac",
        "wav": "audio/wav",
        "opus": "audio/opus",
    }
    return m.get((fmt or "mp3").lower(), "audio/mpeg")
