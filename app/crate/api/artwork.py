import logging

from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import JSONResponse

from crate.api._deps import album_names_from_id, artist_name_from_id, extensions, library_path, safe_path
from crate.api.auth import _require_auth, _require_admin
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.artwork import (
    ArtworkApplyRequest,
    ArtworkExtractRequest,
    ArtworkExtractResponse,
    ArtworkFetchRequest,
    ArtworkMissingResponse,
    ArtworkQueuedResponse,
    ArtworkScanRequest,
)
from crate.api.schemas.common import TaskEnqueueResponse
from crate.audio import get_audio_files
from crate.artwork import extract_embedded_cover, save_cover
from crate.db.repositories.library import get_albums_missing_covers
from crate.db.repositories.tasks import create_task

log = logging.getLogger(__name__)

router = APIRouter(tags=["artwork"])

_ARTWORK_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested artwork resource could not be found."),
        422: error_response("The request payload failed validation."),
    },
)


@router.get(
    "/api/artwork/missing",
    response_model=ArtworkMissingResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List albums missing artwork",
)
def api_artwork_missing(request: Request):
    """List albums missing cover art with details."""
    _require_auth(request)
    import re
    year_re = re.compile(r"^\d{4}\s*[-–]\s*")
    rows = get_albums_missing_covers()
    albums = []
    for r in rows:
        albums.append({
            "name": r["name"],
            "display_name": year_re.sub("", r["name"]),
            "artist": r["artist"],
            "year": r.get("year", ""),
            "mbid": r.get("musicbrainz_albumid"),
            "path": r.get("path", ""),
        })
    return {"missing_count": len(albums), "albums": albums}


@router.post(
    "/api/artwork/scan",
    response_model=TaskEnqueueResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Queue a full missing-artwork scan",
)
def api_artwork_scan(request: Request, body: ArtworkScanRequest | None = None):
    """Queue a full scan for missing covers with source search. Returns task_id for SSE streaming."""
    _require_admin(request)
    auto_apply = body.auto_apply if body else False
    task_id = create_task("scan_missing_covers", {"auto_apply": auto_apply})
    return {"task_id": task_id}


@router.post(
    "/api/artwork/apply",
    response_model=TaskEnqueueResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Queue artwork application for a specific album",
)
def api_artwork_apply(request: Request, body: ArtworkApplyRequest):
    """Apply a specific cover to an album."""
    _require_admin(request)
    task_id = create_task("apply_cover", body.model_dump(exclude_none=True))
    return {"task_id": task_id}


@router.post(
    "/api/artwork/fetch",
    response_model=ArtworkQueuedResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Queue a cover-art fetch by MBID",
)
def api_artwork_fetch(request: Request, data: ArtworkFetchRequest):
    """Queue a task to fetch cover art from CAA."""
    _require_admin(request)
    if not data.mbid:
        return JSONResponse({"error": "No MBID provided"}, status_code=400)
    task_id = create_task("fetch_cover", {"mbid": data.mbid, "path": data.path})
    return {"status": "queued", "task_id": task_id}


@router.post(
    "/api/artwork/extract",
    response_model=ArtworkExtractResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Extract embedded artwork from an album",
)
def api_artwork_extract(request: Request, data: ArtworkExtractRequest):
    """Extract embedded cover — fast enough to run inline."""
    _require_admin(request)
    lib = library_path()
    album_dir = safe_path(lib, data.path)
    if not album_dir or not album_dir.is_dir():
        return JSONResponse({"error": "Album not found"}, status_code=404)

    exts = extensions()
    tracks = get_audio_files(album_dir, exts)
    if not tracks:
        return JSONResponse({"error": "No tracks found"}, status_code=404)

    image = extract_embedded_cover(tracks[0])
    if not image:
        return JSONResponse({"error": "No embedded cover found"}, status_code=404)

    save_cover(album_dir, image)
    return {"status": "saved", "path": str(album_dir / "cover.jpg")}


def api_artwork_fetch_artist(request: Request, name: str):
    """Queue a task to fetch covers for all albums by an artist."""
    _require_admin(request)
    task_id = create_task("fetch_artist_covers", {"artist": name})
    return {"status": "queued", "task_id": task_id}


@router.post(
    "/api/artwork/artists/{artist_id}/fetch",
    response_model=ArtworkQueuedResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Queue artwork fetches for an artist",
)
def api_artwork_fetch_artist_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    return api_artwork_fetch_artist(request, artist_name)


@router.post(
    "/api/artwork/fetch-all",
    response_model=ArtworkQueuedResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Queue fetches for all missing artwork",
)
def api_artwork_fetch_all(request: Request):
    """Queue a task to fetch all missing covers."""
    _require_admin(request)
    task_id = create_task("fetch_artwork_all")
    return {"status": "queued", "task_id": task_id}


async def api_upload_cover(request: Request, artist: str, album: str, file: UploadFile = File(...)):
    """Upload a cover image for an album. Saved to staging, worker copies to album dir."""
    _require_admin(request)
    import base64
    data = await file.read()
    task_id = create_task("upload_image", {
        "type": "cover", "artist": artist, "album": album,
        "data_b64": base64.b64encode(data).decode(),
    })
    return {"status": "queued", "task_id": task_id}


@router.post(
    "/api/artwork/albums/{album_id}/upload-cover",
    response_model=ArtworkQueuedResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Upload album artwork",
)
async def api_upload_cover_by_id(request: Request, album_id: int, file: UploadFile = File(...)):
    album_names = album_names_from_id(album_id)
    if not album_names:
        return JSONResponse({"error": "Album not found"}, status_code=404)
    artist, album = album_names
    return await api_upload_cover(request, artist, album, file)


async def api_upload_artist_photo(request: Request, name: str, file: UploadFile = File(...)):
    """Upload artist photo. Worker saves to artist dir."""
    _require_admin(request)
    import base64
    data = await file.read()
    task_id = create_task("upload_image", {
        "type": "artist_photo", "artist": name,
        "data_b64": base64.b64encode(data).decode(),
    })
    return {"status": "queued", "task_id": task_id}


@router.post(
    "/api/artwork/artists/{artist_id}/upload-photo",
    response_model=ArtworkQueuedResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Upload an artist photo",
)
async def api_upload_artist_photo_by_id(request: Request, artist_id: int, file: UploadFile = File(...)):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    return await api_upload_artist_photo(request, artist_name, file)


async def api_upload_background(request: Request, name: str, file: UploadFile = File(...)):
    """Upload artist background. Worker saves to artist dir."""
    _require_admin(request)
    import base64
    data = await file.read()
    task_id = create_task("upload_image", {
        "type": "background", "artist": name,
        "data_b64": base64.b64encode(data).decode(),
    })
    return {"status": "queued", "task_id": task_id}


@router.post(
    "/api/artwork/artists/{artist_id}/upload-background",
    response_model=ArtworkQueuedResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Upload an artist background image",
)
async def api_upload_background_by_id(request: Request, artist_id: int, file: UploadFile = File(...)):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    return await api_upload_background(request, artist_name, file)
