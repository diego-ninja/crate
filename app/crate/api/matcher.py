from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from crate.api.auth import _require_admin
from crate.matcher import match_album
from crate.db import create_task, get_library_album_by_id
from crate.api._deps import library_path, extensions
from crate.api.browse_shared import find_album_dir

router = APIRouter()


class MatchApplyRequest(BaseModel):
    album_id: int
    release: dict


def api_match_album(request: Request, artist: str, album: str):
    _require_admin(request)
    lib = library_path()
    album_dir = find_album_dir(lib, artist, album)
    if not album_dir:
        return JSONResponse({"error": "Not found"}, status_code=404)

    exts = extensions()
    candidates = match_album(album_dir, exts)
    return candidates


@router.get("/api/match/albums/{album_id}")
def api_match_album_by_id(request: Request, album_id: int):
    album = get_library_album_by_id(album_id)
    if not album:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return api_match_album(request, album["artist"], album["name"])


@router.post("/api/match/apply")
def api_match_apply(request: Request, data: MatchApplyRequest):
    _require_admin(request)
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
