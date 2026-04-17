"""Subsonic API compatible endpoints.

Allows third-party music players (Symfonium, DSub, play:Sub, Ultrasonic, etc.)
to browse, search, and stream from the Crate library.

Spec: http://www.subsonic.org/pages/api.jsp
"""

import hashlib
import hmac
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse

from crate.db import get_user_by_email
from crate.db.queries.subsonic import (
    get_user_by_username,
    get_all_artists_sorted,
    get_artist_by_id,
    get_albums_by_artist_name,
    get_album_with_artist,
    get_tracks_by_album_id,
    get_track_full,
    get_album_list,
    search_artists,
    search_albums,
    search_tracks,
    get_track_path_and_format,
    get_track_basic,
    get_random_tracks,
)
from crate.auth import verify_password
from crate.api._deps import library_path
from crate.api.schemas.subsonic import (
    SubsonicAlbumList2Response,
    SubsonicAlbumResponse,
    SubsonicArtistResponse,
    SubsonicArtistsResponse,
    SubsonicLicenseResponse,
    SubsonicMusicFoldersResponse,
    SubsonicOkResponse,
    SubsonicPlaylistsResponse,
    SubsonicRandomSongsResponse,
    SubsonicSearchResult3Response,
    SubsonicSongResponse,
    SubsonicStarred2Response,
    SubsonicUserResponse,
)

log = logging.getLogger(__name__)

SUBSONIC_API_VERSION = "1.16.1"
SERVER_NAME = "Crate"


def _subsonic_docs_params(
    username: str = Query("", alias="u", description="Subsonic username or email."),
    password: str = Query(
        "",
        alias="p",
        description="Plain password, or `enc:` plus a UTF-8 hex payload. Use either `p` or `t` + `s`.",
    ),
    token: str = Query("", alias="t", description="MD5 token used for Subsonic token authentication."),
    salt: str = Query("", alias="s", description="Random salt paired with `t`."),
    version: str = Query(SUBSONIC_API_VERSION, alias="v", description="Requested Subsonic API version."),
    client: str = Query("crate-docs", alias="c", description="Client identifier."),
    response_format: str = Query(
        "json",
        alias="f",
        description="Requested response format. Crate currently responds with JSON.",
    ),
) -> None:
    del username, password, token, salt, version, client, response_format


router = APIRouter(prefix="/rest", tags=["subsonic"], dependencies=[Depends(_subsonic_docs_params)])


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
        user = get_user_by_username(username)

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

@router.get("/ping", response_model=SubsonicOkResponse, summary="Ping the Subsonic API")
@router.get("/ping.view", include_in_schema=False)
def ping(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")
    return _subsonic_response({})


@router.get("/getLicense", response_model=SubsonicLicenseResponse, summary="Get the Subsonic license status")
@router.get("/getLicense.view", include_in_schema=False)
def get_license(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")
    return _subsonic_response({
        "license": {"valid": True, "email": "crate@local", "licenseExpires": "2099-12-31T00:00:00"}
    })


@router.get(
    "/getMusicFolders",
    response_model=SubsonicMusicFoldersResponse,
    summary="List available Subsonic music folders",
)
@router.get("/getMusicFolders.view", include_in_schema=False)
def get_music_folders(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")
    return _subsonic_response({
        "musicFolders": {"musicFolder": [{"id": 1, "name": "Music"}]}
    })


@router.get("/getUser", response_model=SubsonicUserResponse, summary="Fetch a Subsonic user profile")
@router.get("/getUser.view", include_in_schema=False)
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

@router.get("/getArtists", response_model=SubsonicArtistsResponse, summary="Browse artists grouped by index letter")
@router.get("/getArtists.view", include_in_schema=False)
def get_artists(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    rows = get_all_artists_sorted()

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


@router.get("/getArtist", response_model=SubsonicArtistResponse, summary="Fetch a Subsonic artist with albums")
@router.get("/getArtist.view", include_in_schema=False)
def get_artist(request: Request, id: str = Query("")):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    artist_id = int(id.replace("ar-", "")) if id.startswith("ar-") else int(id)

    artist = get_artist_by_id(artist_id)
    if not artist:
        return _subsonic_error(70, "Artist not found")

    albums = get_albums_by_artist_name(artist["name"])

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


@router.get("/getAlbum", response_model=SubsonicAlbumResponse, summary="Fetch a Subsonic album with songs")
@router.get("/getAlbum.view", include_in_schema=False)
def get_album(request: Request, id: str = Query("")):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    album_id = int(id.replace("al-", "")) if id.startswith("al-") else int(id)

    album = get_album_with_artist(album_id)
    if not album:
        return _subsonic_error(70, "Album not found")

    tracks = get_tracks_by_album_id(album_id)

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


@router.get("/getSong", response_model=SubsonicSongResponse, summary="Fetch a single Subsonic song")
@router.get("/getSong.view", include_in_schema=False)
def get_song(request: Request, id: str = Query("")):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    track_id = int(id)
    t = get_track_full(track_id)
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

@router.get(
    "/getAlbumList2",
    response_model=SubsonicAlbumList2Response,
    summary="List albums using a Subsonic album-list strategy",
)
@router.get("/getAlbumList2.view", include_in_schema=False)
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

    albums = get_album_list(order, size, offset)

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

@router.get("/search3", response_model=SubsonicSearchResult3Response, summary="Search artists, albums, and songs")
@router.get("/search3.view", include_in_schema=False)
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

    result["artist"] = [{"id": f"ar-{r['id']}", "name": r["name"]} for r in search_artists(q, artistCount)]

    result["album"] = [{
        "id": f"al-{r['id']}", "name": r["name"], "artist": r["artist"],
        "artistId": f"ar-{r['artist_id']}" if r["artist_id"] else None,
        "year": int(r["year"]) if r["year"] else None,
        "coverArt": f"al-{r['id']}" if r["has_cover"] else None,
    } for r in search_albums(q, albumCount)]

    result["song"] = [{
        "id": str(r["id"]), "title": r["title"], "artist": r["artist"],
        "album": r["album"], "duration": r["duration"] or 0,
        "albumId": f"al-{r['album_id']}" if r["album_id"] else None,
        "artistId": f"ar-{r['artist_id']}" if r["artist_id"] else None,
        "coverArt": f"al-{r['album_id']}" if r["album_id"] and r["has_cover"] else None,
        "suffix": (r["format"] or "mp3").lower(),
        "contentType": _content_type(r["format"]),
        "type": "music",
    } for r in search_tracks(q, songCount)]

    return _subsonic_response({"searchResult3": result})


# ── Stream & Cover Art ──────────────────────────────────────────

@router.get(
    "/stream",
    summary="Stream a track through the Subsonic API",
    responses={
        200: {
            "description": "Audio stream for the requested track, or a Subsonic error envelope.",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/SubsonicOkResponse"}},
                "audio/mpeg": {"schema": {"type": "string", "format": "binary"}},
                "audio/flac": {"schema": {"type": "string", "format": "binary"}},
                "audio/ogg": {"schema": {"type": "string", "format": "binary"}},
                "audio/mp4": {"schema": {"type": "string", "format": "binary"}},
                "audio/aac": {"schema": {"type": "string", "format": "binary"}},
                "audio/wav": {"schema": {"type": "string", "format": "binary"}},
                "audio/opus": {"schema": {"type": "string", "format": "binary"}},
            },
        },
        403: {"description": "Forbidden path outside the library root."},
        404: {"description": "Track file not found."},
    },
)
@router.get("/stream.view", include_in_schema=False)
def stream(request: Request, id: str = Query("")):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    track_id = int(id)
    track = get_track_path_and_format(track_id)
    if not track:
        return Response(status_code=404)

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


@router.get(
    "/getCoverArt",
    summary="Fetch album or artist artwork via the Subsonic API",
    responses={
        200: {
            "description": "Artwork image, or a Subsonic error envelope.",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/SubsonicOkResponse"}},
                "image/jpeg": {"schema": {"type": "string", "format": "binary"}},
                "image/png": {"schema": {"type": "string", "format": "binary"}},
                "image/webp": {"schema": {"type": "string", "format": "binary"}},
            },
        },
        404: {"description": "Artwork not found."},
    },
)
@router.get("/getCoverArt.view", include_in_schema=False)
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

@router.get("/scrobble", response_model=SubsonicOkResponse, summary="Record a completed Subsonic scrobble")
@router.get("/scrobble.view", include_in_schema=False)
@router.post("/scrobble", response_model=SubsonicOkResponse, summary="Record a completed Subsonic scrobble")
@router.post("/scrobble.view", include_in_schema=False)
def scrobble(request: Request, id: str = Query(""), submission: str = Query("true")):
    try:
        user = _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    if submission != "true":
        return _subsonic_response({})

    track_id = int(id)
    track = get_track_basic(track_id)

    if track:
        from crate.db.user_library import record_play
        record_play(user["id"], track_id=track_id, title=track["title"], artist=track["artist"], album=track["album"])

    return _subsonic_response({})


# ── Stubs (required by clients but not critical) ────────────────

@router.get("/getPlaylists", response_model=SubsonicPlaylistsResponse, summary="List playlists for Subsonic clients")
@router.get("/getPlaylists.view", include_in_schema=False)
def get_playlists(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")
    return _subsonic_response({"playlists": {"playlist": []}})


@router.get("/getStarred2", response_model=SubsonicStarred2Response, summary="List starred artists, albums, and songs")
@router.get("/getStarred2.view", include_in_schema=False)
def get_starred2(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")
    return _subsonic_response({"starred2": {"artist": [], "album": [], "song": []}})


@router.get("/getRandomSongs", response_model=SubsonicRandomSongsResponse, summary="Fetch random songs for Subsonic clients")
@router.get("/getRandomSongs.view", include_in_schema=False)
def get_random_songs(request: Request, size: int = Query(10)):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    tracks = get_random_tracks(size)

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
