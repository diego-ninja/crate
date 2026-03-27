from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from musicdock.api.auth import _require_admin
from musicdock.organizer import preview_organize, organize_album, suggest_folder_name, PRESETS
from musicdock.api._deps import library_path, extensions, safe_path

router = APIRouter()


class OrganizeApplyRequest(BaseModel):
    pattern: str | None = None
    rename_folder: str | None = None


@router.get("/api/organize/presets")
def api_organize_presets(request: Request):
    _require_admin(request)
    return PRESETS


@router.get("/api/organize/preview/{artist:path}/{album:path}")
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


@router.post("/api/organize/apply/{artist:path}/{album:path}")
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
