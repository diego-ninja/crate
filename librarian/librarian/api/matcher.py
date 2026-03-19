from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from librarian.matcher import match_album, apply_match
from librarian.api._deps import library_path, extensions, safe_path

router = APIRouter()


class MatchApplyRequest(BaseModel):
    artist_folder: str
    album_folder: str
    release: dict


@router.get("/api/match/{artist:path}/{album:path}")
def api_match_album(artist: str, album: str):
    lib = library_path()
    album_dir = safe_path(lib, f"{artist}/{album}")
    if not album_dir or not album_dir.is_dir():
        return JSONResponse({"error": "Not found"}, status_code=404)

    exts = extensions()
    candidates = match_album(album_dir, exts)
    return candidates


@router.post("/api/match/apply")
def api_match_apply(data: MatchApplyRequest):
    lib = library_path()
    album_dir = safe_path(lib, f"{data.artist_folder}/{data.album_folder}")
    if not album_dir or not album_dir.is_dir():
        return JSONResponse({"error": "Album not found"}, status_code=404)

    exts = extensions()
    result = apply_match(album_dir, exts, data.release)
    return result
