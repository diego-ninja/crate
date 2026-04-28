from fastapi import APIRouter, HTTPException, Request

from crate.api.auth import _require_admin
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.utility import (
    OrganizeApplyRequest,
    OrganizeApplyResponse,
    OrganizePresetsResponse,
    OrganizePreviewResponse,
)
from crate.organizer import preview_organize, organize_album, suggest_folder_name, PRESETS
from crate.api._deps import library_path, extensions, safe_path
from crate.db.repositories.library import get_library_album_by_id

router = APIRouter(tags=["organizer"])

_ORGANIZER_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        404: error_response("The requested album could not be found."),
        422: error_response("The request payload failed validation."),
    },
)


@router.get(
    "/api/organize/presets",
    response_model=OrganizePresetsResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List file-organization presets",
)
def api_organize_presets(request: Request):
    _require_admin(request)
    return PRESETS


def api_organize_preview(request: Request, artist: str, album: str, pattern: str | None = None):
    _require_admin(request)
    lib = library_path()
    album_dir = safe_path(lib, f"{artist}/{album}")
    if not album_dir or not album_dir.is_dir():
        raise HTTPException(status_code=404, detail="Not found")

    exts = extensions()
    preview = preview_organize(album_dir, exts, pattern)
    folder_suggestion = suggest_folder_name(album_dir, exts, include_year="year" in (pattern or ""))

    return {
        "tracks": preview,
        "folder_current": album_dir.name,
        "folder_suggested": folder_suggestion,
        "changes": sum(1 for p in preview if p["changed"]),
    }


def api_organize_apply(request: Request, artist: str, album: str, data: OrganizeApplyRequest | None = None):
    _require_admin(request)
    lib = library_path()
    album_dir = safe_path(lib, f"{artist}/{album}")
    if not album_dir or not album_dir.is_dir():
        raise HTTPException(status_code=404, detail="Not found")

    exts = extensions()
    pattern = data.pattern if data else None
    rename_folder = data.rename_folder if data else None

    result = organize_album(album_dir, exts, pattern, rename_folder)
    return result


@router.get(
    "/api/organize/albums/{album_id}/preview",
    response_model=OrganizePreviewResponse,
    responses=_ORGANIZER_RESPONSES,
    summary="Preview file-organization changes for an album",
)
def api_organize_preview_by_id(request: Request, album_id: int, pattern: str | None = None):
    album = get_library_album_by_id(album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Not found")
    return api_organize_preview(request, album["artist"], album["name"], pattern)


@router.post(
    "/api/organize/albums/{album_id}/apply",
    response_model=OrganizeApplyResponse,
    responses=_ORGANIZER_RESPONSES,
    summary="Apply file-organization changes to an album",
)
def api_organize_apply_by_id(request: Request, album_id: int, data: OrganizeApplyRequest | None = None):
    album = get_library_album_by_id(album_id)
    if not album:
        raise HTTPException(status_code=404, detail="Not found")
    return api_organize_apply(request, album["artist"], album["name"], data)
