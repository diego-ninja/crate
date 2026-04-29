from pathlib import Path

import mutagen
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, Response

from crate.api._deps import COVER_NAMES, extensions, library_path
from crate.api.auth import _require_auth
from crate.api.image_variants import build_image_response
from crate.api.browse_shared import build_genre_profile, display_name, find_album_dir, find_album_row, fs_album_detail, has_library_data
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.browse import AlbumDetailResponse, RelatedAlbumResponse
from crate.api.schemas.common import TaskEnqueueResponse
from crate.audio import get_audio_files
from crate.db.repositories.library import (
    get_library_album_by_id,
    get_library_album_by_entity_uid,
    get_library_albums,
    get_library_artist,
    get_library_artist_by_slug,
    get_library_tracks,
)
from crate.db.queries.browse import get_album_genre_ids, get_related_albums, get_album_genres_list, get_album_genre_profile
from crate.db.repositories.tasks import create_task
from crate.slugs import build_public_album_slug
from crate.storage_layout import resolve_album_dir

router = APIRouter(tags=["browse"])

_BROWSE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested browse resource could not be found."),
        422: error_response("The request payload failed validation."),
    },
)

_IMAGE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        200: {
            "description": "Binary image response.",
            "content": {
                "image/jpeg": {},
                "image/png": {},
                "image/svg+xml": {},
            },
        },
        404: error_response("The requested image was not found."),
    },
)

_ZIP_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        200: {
            "description": "Zip archive download.",
            "content": {
                "application/zip": {},
            },
        },
        404: error_response("The requested album archive was not found."),
    },
)


@router.get(
    "/api/albums/{album_id}/related",
    response_model=list[RelatedAlbumResponse],
    responses=_BROWSE_RESPONSES,
    summary="List albums related to a given album",
)
def api_related_albums_by_id(request: Request, album_id: int, limit: int = 15):
    album = get_library_album_by_id(album_id)
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_related_albums(request, album["artist"], album["name"], limit)


@router.get(
    "/api/albums/by-entity/{album_entity_uid}/related",
    response_model=list[RelatedAlbumResponse],
    responses=_BROWSE_RESPONSES,
    summary="List albums related to a given album by entity UID",
)
def api_related_albums_by_entity_uid(request: Request, album_entity_uid: str, limit: int = 15):
    album = get_library_album_by_entity_uid(album_entity_uid)
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_related_albums(request, album["artist"], album["name"], limit)


def api_related_albums(request: Request, artist: str, album: str, limit: int = 15):
    """Find related albums: same artist, same genre+decade, similar audio profile."""
    _require_auth(request)
    related = []
    seen = set()

    current = find_album_row(artist, album)
    if not current:
        return []

    album_id = current["id"]
    year = current["year"][:4] if current.get("year") and len(current.get("year", "")) >= 4 else None
    seen.add(album_id)

    genre_ids = get_album_genre_ids(album_id)
    grouped = get_related_albums(album_id, artist, year, genre_ids)
    for reason, rows in grouped.items():
        for row in rows:
            if row["id"] not in seen:
                seen.add(row["id"])
                related.append({**row, "reason": reason})

    import re

    year_re = re.compile(r"^\d{4}\s*[-–]\s*")
    for row in related:
        row["display_name"] = year_re.sub("", row["name"])

    return related[:limit]


def api_album(request: Request, artist: str, album: str):
    _require_auth(request)
    if not has_library_data():
        result = fs_album_detail(artist, album)
        if result is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return result

    album_data = find_album_row(artist, album)
    if not album_data:
        result = fs_album_detail(artist, album)
        if result is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return result

    tracks_data = get_library_tracks(album_data["id"])
    lib = library_path()
    album_dir = find_album_dir(lib, artist, album)
    has_cover = album_data.get("has_cover", False)
    cover_file = None
    if album_dir and album_dir.is_dir():
        for cover_name in COVER_NAMES:
            if (album_dir / cover_name).exists():
                cover_file = cover_name
                break

    track_list = []
    album_tags = {}
    for track in tracks_data:
        entity_uid = track.get("entity_uid")
        track_list.append(
            {
                "id": track["id"],
                "entity_uid": entity_uid,
                "filename": track["filename"],
                "format": track.get("format", ""),
                "size_mb": round(track["size"] / (1024**2), 1) if track.get("size") else 0,
                "bitrate": track.get("bitrate") // 1000 if track.get("bitrate") else None,
                "sample_rate": track.get("sample_rate"),
                "bit_depth": track.get("bit_depth"),
                "length_sec": round(track["duration"]) if track.get("duration") else 0,
                "popularity": track.get("popularity"),
                "popularity_score": track.get("popularity_score"),
                "popularity_confidence": track.get("popularity_confidence"),
                "rating": track.get("rating", 0) or 0,
                "tags": {
                    "title": track.get("title", ""),
                    "artist": track.get("artist", ""),
                    "album": track.get("album", ""),
                    "albumartist": track.get("albumartist", ""),
                    "tracknumber": str(track.get("track_number", "")),
                    "discnumber": str(track.get("disc_number", "")),
                    "date": track.get("year", ""),
                    "genre": track.get("genre", ""),
                    "musicbrainz_albumid": track.get("musicbrainz_albumid", ""),
                    "musicbrainz_trackid": track.get("musicbrainz_trackid", ""),
                },
                "path": str(Path(track["path"]).relative_to(lib)) if track.get("path") else "",
            }
        )
        if not album_tags and track.get("album"):
            album_tags = {
                "artist": track.get("albumartist") or track.get("artist", ""),
                "album": track.get("album", ""),
                "year": track.get("year", "")[:4] if track.get("year") else "",
                "genre": track.get("genre", ""),
                "musicbrainz_albumid": track.get("musicbrainz_albumid"),
            }

    total_size = sum(track.get("size", 0) or 0 for track in tracks_data)
    total_length = sum(track["length_sec"] for track in track_list)

    album_genres = get_album_genres_list(album_data["id"])
    genre_profile = build_genre_profile(get_album_genre_profile(album_data["id"]), limit=6)

    if album_genres:
        album_tags["genre"] = ", ".join(album_genres)

    # Prefer DB MBID (set by matcher) over tag MBID
    db_mbid = album_data.get("musicbrainz_albumid")
    if db_mbid and db_mbid.strip():
        album_tags["musicbrainz_albumid"] = db_mbid

    return {
        "id": album_data["id"],
        "entity_uid": album_data.get("entity_uid"),
        "slug": album_data.get("slug"),
        "artist_id": artist_row["id"] if (artist_row := get_library_artist(artist)) else None,
        "artist_entity_uid": artist_row.get("entity_uid") if artist_row else None,
        "artist_slug": artist_row["slug"] if artist_row else None,
        "artist": artist,
        "name": album,
        "display_name": display_name(album),
        "path": album_data.get("path", ""),
        "track_count": len(tracks_data),
        "total_size_mb": round(total_size / (1024**2)),
        "total_length_sec": total_length,
        "has_cover": bool(has_cover),
        "cover_file": cover_file,
        "tracks": track_list,
        "album_tags": album_tags,
        "musicbrainz_albumid": db_mbid,
        "genres": album_genres,
        "genre_profile": genre_profile,
        "popularity": album_data.get("popularity"),
        "popularity_score": album_data.get("popularity_score"),
        "popularity_confidence": album_data.get("popularity_confidence"),
    }


@router.get(
    "/api/artist-slugs/{artist_slug}/albums/{album_slug}",
    response_model=AlbumDetailResponse,
    responses=_BROWSE_RESPONSES,
    summary="Get detailed album information by artist and album slug",
)
def api_album_by_artist_slug(request: Request, artist_slug: str, album_slug: str):
    artist = get_library_artist_by_slug(artist_slug)
    if not artist:
        return JSONResponse({"error": "Not found"}, status_code=404)

    album = next(
        (
            current
            for current in get_library_albums(artist["name"])
            if build_public_album_slug(current.get("name")) == album_slug
            or current.get("slug") == album_slug
        ),
        None,
    )
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_album(request, artist["name"], album["name"])


@router.get(
    "/api/albums/by-entity/{album_entity_uid}",
    response_model=AlbumDetailResponse,
    responses=_BROWSE_RESPONSES,
    summary="Get detailed album information by entity UID",
)
def api_album_by_entity_uid(request: Request, album_entity_uid: str):
    album = get_library_album_by_entity_uid(album_entity_uid)
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_album(request, album["artist"], album["name"])


@router.get(
    "/api/albums/{album_id}",
    response_model=AlbumDetailResponse,
    responses=_BROWSE_RESPONSES,
    summary="Get detailed album information",
)
def api_album_by_id(request: Request, album_id: int):
    album = get_library_album_by_id(album_id)
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_album(request, album["artist"], album["name"])


def _placeholder_cover(seed: str) -> Response:
    """Return a deterministic SVG placeholder so <img> never 404s."""
    # Pick a hue from the seed string
    h = sum(ord(c) for c in (seed or "?")) % 360
    initial = (seed.strip()[:1] or "?").upper()
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">'
        f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0%" stop-color="hsl({h},45%,28%)"/>'
        f'<stop offset="100%" stop-color="hsl({(h + 30) % 360},35%,15%)"/>'
        f'</linearGradient></defs>'
        f'<rect width="200" height="200" fill="url(#g)"/>'
        f'<text x="100" y="118" font-family="sans-serif" font-size="86" '
        f'font-weight="700" fill="rgba(255,255,255,0.42)" text-anchor="middle">{initial}</text>'
        f'</svg>'
    )
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={"Cache-Control": "public, max-age=3600"},
    )


def _extract_embedded_cover(audio_file: Path) -> tuple[bytes, str] | None:
    """Return (data, mime) for the first embedded cover in ``audio_file``.

    Handles FLAC (``audio.pictures``), Ogg/Opus (METADATA_BLOCK_PICTURE) and
    ID3-tagged files (MP3/AIFF with APIC frames) without blowing up on the
    tuple-vs-string iteration difference between ``VComment`` and ``ID3``.
    """
    try:
        audio = mutagen.File(audio_file)
    except Exception:
        return None
    if audio is None:
        return None

    # FLAC / Ogg / Opus expose pictures directly.
    pictures = getattr(audio, "pictures", None)
    if pictures:
        pic = pictures[0]
        return pic.data, pic.mime

    tags = getattr(audio, "tags", None)
    if not tags:
        return None

    # ID3 (MP3, AIFF, WAV) — tags iterates as string frame keys and indexing
    # returns the frame object. FLAC VComment iterates as (key, value) tuples
    # where the value is a plain text string, so APIC never lives there.
    try:
        keys = list(tags.keys()) if hasattr(tags, "keys") else list(tags)
    except Exception:
        return None
    for key in keys:
        if not isinstance(key, str) or not key.startswith("APIC"):
            continue
        frame = tags.get(key) if hasattr(tags, "get") else tags[key]
        data = getattr(frame, "data", None)
        mime = getattr(frame, "mime", None) or "image/jpeg"
        if data:
            return data, mime
    return None


def api_cover(artist: str, album: str, album_dir: Path | None = None, *, size: int | None = None):
    lib = library_path()
    # Prefer the caller-supplied canonical directory (from api_cover_by_id)
    # so we don't get fooled by a loose duplicate folder under /Artist/Album
    # that shadows the real /Artist/YYYY/Album entry in the DB.
    if album_dir is None or not album_dir.is_dir():
        album_dir = find_album_dir(lib, artist, album)
    if not album_dir:
        return _placeholder_cover(album or artist)

    _IMG_CACHE = {"Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"}

    for cover_name in COVER_NAMES:
        cover = album_dir / cover_name
        if cover.exists():
            media_type = "image/jpeg" if cover.suffix == ".jpg" else "image/png"
            return build_image_response(cover.read_bytes(), media_type, size=size, headers=_IMG_CACHE)

    exts = extensions()
    tracks = get_audio_files(album_dir, exts)
    for track in tracks:
        extracted = _extract_embedded_cover(track)
        if extracted:
            data, mime = extracted
            return build_image_response(data, mime, size=size, headers=_IMG_CACHE)

    return _placeholder_cover(album or artist)


@router.post(
    "/api/albums/{album_id}/enrich",
    response_model=TaskEnqueueResponse,
    responses=_BROWSE_RESPONSES,
    summary="Queue album enrichment",
)
def api_enrich_album(request: Request, album_id: int):
    """Enrich an album: MBID lookup, cover fetch, audio analysis, bliss."""
    _require_auth(request)
    album = get_library_album_by_id(album_id)
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    task_id = create_task("process_new_content", {
        "artist": album["artist"],
        "album": album["name"],
        "force": True,
    })
    return {"task_id": task_id}


@router.post(
    "/api/albums/by-entity/{album_entity_uid}/enrich",
    response_model=TaskEnqueueResponse,
    responses=_BROWSE_RESPONSES,
    summary="Queue album enrichment by entity UID",
)
def api_enrich_album_by_entity_uid(request: Request, album_entity_uid: str):
    album = get_library_album_by_entity_uid(album_entity_uid)
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_enrich_album(request, album["id"])


@router.post(
    "/api/albums/{album_id}/fetch-cover",
    response_model=TaskEnqueueResponse,
    responses=_BROWSE_RESPONSES,
    summary="Queue artwork fetching for an album",
)
def api_fetch_cover(request: Request, album_id: int):
    """Search and download a cover for an album from all available sources."""
    _require_auth(request)
    album = get_library_album_by_id(album_id)
    if not album:
        return JSONResponse({"error": "Album not found"}, status_code=404)
    task_id = create_task("fetch_album_cover", {
        "album_id": album_id,
        "artist": album["artist"],
        "album": album["name"],
        "path": album.get("path", ""),
        "mbid": album.get("musicbrainz_albumid", ""),
    })
    return {"task_id": task_id}


@router.post(
    "/api/albums/by-entity/{album_entity_uid}/fetch-cover",
    response_model=TaskEnqueueResponse,
    responses=_BROWSE_RESPONSES,
    summary="Queue artwork fetching for an album by entity UID",
)
def api_fetch_cover_by_entity_uid(request: Request, album_entity_uid: str):
    album = get_library_album_by_entity_uid(album_entity_uid)
    if not album:
        return JSONResponse({"error": "Album not found"}, status_code=404)
    return api_fetch_cover(request, album["id"])


@router.get(
    "/api/albums/{album_id}/cover",
    responses=_IMAGE_RESPONSES,
    summary="Get album artwork",
)
def api_cover_by_id(album_id: int, size: int | None = Query(None, ge=32, le=1024)):
    album = get_library_album_by_id(album_id)
    if not album:
        return _placeholder_cover("?")
    artist = get_library_artist(album["artist"])
    album_dir = resolve_album_dir(library_path(), album, artist=artist)
    return api_cover(album["artist"], album["name"], album_dir=album_dir, size=size)


@router.get(
    "/api/albums/by-entity/{album_entity_uid}/cover",
    responses=_IMAGE_RESPONSES,
    summary="Get album artwork by entity UID",
)
def api_cover_by_entity_uid(album_entity_uid: str, size: int | None = Query(None, ge=32, le=1024)):
    album = get_library_album_by_entity_uid(album_entity_uid)
    if not album:
        return _placeholder_cover("?")
    artist = get_library_artist(album["artist"])
    album_dir = resolve_album_dir(library_path(), album, artist=artist)
    return api_cover(album["artist"], album["name"], album_dir=album_dir, size=size)


def api_download_album(request: Request, artist: str, album: str):
    """Download an entire album as a ZIP file."""
    _require_auth(request)
    import tempfile
    import zipfile

    from fastapi.responses import FileResponse

    lib = library_path()
    album_dir = find_album_dir(lib, artist, album)
    if not album_dir:
        return Response(status_code=404)

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp.close()

    exts = extensions()
    with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_STORED) as zip_file:
        for file_path in sorted(album_dir.iterdir()):
            if file_path.is_file() and (
                file_path.suffix.lower() in exts
                or file_path.name.lower() in ("cover.jpg", "cover.png", "folder.jpg", "front.jpg")
            ):
                zip_file.write(str(file_path), file_path.name)

    safe_name = f"{artist} - {album}.zip".replace("/", "-")
    return FileResponse(path=tmp.name, filename=safe_name, media_type="application/zip", background=None)


@router.get(
    "/api/albums/{album_id}/download",
    responses=_ZIP_RESPONSES,
    summary="Download an album as a zip archive",
)
def api_download_album_by_id(request: Request, album_id: int):
    album = get_library_album_by_id(album_id)
    if not album:
        return Response(status_code=404)
    return api_download_album(request, album["artist"], album["name"])


@router.get(
    "/api/albums/by-entity/{album_entity_uid}/download",
    responses=_ZIP_RESPONSES,
    summary="Download an album as a zip archive by entity UID",
)
def api_download_album_by_entity_uid(request: Request, album_entity_uid: str):
    album = get_library_album_by_entity_uid(album_entity_uid)
    if not album:
        return Response(status_code=404)
    return api_download_album(request, album["artist"], album["name"])
