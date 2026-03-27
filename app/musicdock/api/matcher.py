from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from musicdock.api.auth import _require_admin
from musicdock.matcher import match_album
from musicdock.db import create_task
from musicdock.api._deps import library_path, extensions, safe_path
from musicdock.api.browse import _find_album_dir

router = APIRouter()


class MatchApplyRequest(BaseModel):
    artist_folder: str
    album_folder: str
    release: dict


@router.get("/api/match/{artist:path}/{album:path}")
def api_match_album(request: Request, artist: str, album: str):
    _require_admin(request)
    lib = library_path()
    album_dir = _find_album_dir(lib, artist, album)
    if not album_dir:
        return JSONResponse({"error": "Not found"}, status_code=404)

    exts = extensions()
    candidates = match_album(album_dir, exts)
    return candidates


@router.post("/api/match/apply")
def api_match_apply(request: Request, data: MatchApplyRequest):
    _require_admin(request)
    lib = library_path()
    album_dir = _find_album_dir(lib, data.artist_folder, data.album_folder)
    if not album_dir:
        return JSONResponse({"error": "Album not found"}, status_code=404)

    task_id = create_task("match_apply", {
        "artist_folder": data.artist_folder,
        "album_folder": data.album_folder,
        "album_path": str(album_dir),
        "release": data.release,
    })
    return {"task_id": task_id}
