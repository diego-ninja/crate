from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from crate.api.auth import _require_admin
from crate.organizer import preview_organize, organize_album, suggest_folder_name, PRESETS
from crate.api._deps import library_path, extensions, safe_path
from crate.db import get_library_album_by_id

router = APIRouter()


class OrganizeApplyRequest(BaseModel):
    pattern: str | None = None
    rename_folder: str | None = None


@router.get("/api/organize/presets")
def api_organize_presets(request: Request):
    _require_admin(request)
    return PRESETS


def api_organize_preview(request: Request, artist: str, album: str, pattern: str | None = None):
    _require_admin(request)
    lib = library_path()
    album_dir = safe_path(lib, f"{artist}/{album}")
    if not album_dir or not album_dir.is_dir():
        return JSONResponse({"error": "Not found"}, status_code=404)

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
        return JSONResponse({"error": "Not found"}, status_code=404)

    exts = extensions()
    pattern = data.pattern if data else None
    rename_folder = data.rename_folder if data else None

    result = organize_album(album_dir, exts, pattern, rename_folder)
    return result


@router.get("/api/organize/albums/{album_id}/preview")
def api_organize_preview_by_id(request: Request, album_id: int, pattern: str | None = None):
    album = get_library_album_by_id(album_id)
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_organize_preview(request, album["artist"], album["name"], pattern)


@router.post("/api/organize/albums/{album_id}/apply")
def api_organize_apply_by_id(request: Request, album_id: int, data: OrganizeApplyRequest | None = None):
    album = get_library_album_by_id(album_id)
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_organize_apply(request, album["artist"], album["name"], data)
