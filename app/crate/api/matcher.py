from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from crate.api.auth import _require_admin
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.common import TaskEnqueueResponse
from crate.api.schemas.operations import MatchApplyRequest, MatchCandidateResponse
from crate.matcher import match_album
from crate.api._deps import library_path, extensions
from crate.api.browse_shared import find_album_dir
from crate.db.repositories.library import get_library_album_by_entity_uid, get_library_album_by_id
from crate.db.repositories.tasks import create_task

router = APIRouter(tags=["matcher"])

_MATCHER_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        404: error_response("The requested album could not be found."),
        422: error_response("The request payload failed validation."),
    },
)


def api_match_album(request: Request, artist: str, album: str):
    _require_admin(request)
    lib = library_path()
    album_dir = find_album_dir(lib, artist, album)
    if not album_dir:
        return JSONResponse({"error": "Not found"}, status_code=404)

    exts = extensions()
    candidates = match_album(album_dir, exts)
    return candidates


@router.get(
    "/api/match/albums/{album_id}",
    response_model=list[MatchCandidateResponse],
    responses=_MATCHER_RESPONSES,
    summary="List MusicBrainz match candidates for an album",
)
def api_match_album_by_id(request: Request, album_id: int):
    album = get_library_album_by_id(album_id)
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_match_album(request, album["artist"], album["name"])


@router.get(
    "/api/match/albums/by-entity/{album_entity_uid}",
    response_model=list[MatchCandidateResponse],
    responses=_MATCHER_RESPONSES,
    summary="List MusicBrainz match candidates for an album by entity UID",
)
def api_match_album_by_entity_uid(request: Request, album_entity_uid: str):
    album = get_library_album_by_entity_uid(album_entity_uid)
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_match_album(request, album["artist"], album["name"])


@router.post(
    "/api/match/apply",
    response_model=TaskEnqueueResponse,
    responses=_MATCHER_RESPONSES,
    summary="Queue tag application from a chosen match",
)
def api_match_apply(request: Request, data: MatchApplyRequest):
    _require_admin(request)
    album = None
    if data.album_entity_uid:
        album = get_library_album_by_entity_uid(data.album_entity_uid)
    if album is None and data.album_id is not None:
        album = get_library_album_by_id(data.album_id)
    if not album:
        return JSONResponse({"error": "Album not found"}, status_code=404)

    lib = library_path()
    album_dir = find_album_dir(lib, album["artist"], album["name"])
    if not album_dir:
        return JSONResponse({"error": "Album not found"}, status_code=404)

    task_id = create_task("match_apply", {
        "artist_folder": album["artist"],
        "album_folder": album["name"],
        "album_path": str(album_dir),
        "release": data.release,
    })
    return {"task_id": task_id}
