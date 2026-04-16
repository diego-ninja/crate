from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from crate.api.auth import _require_admin
from crate.api._deps import album_names_from_id, library_path, safe_path
from crate.db import create_task, get_library_album_by_id, get_track_path_by_id

router = APIRouter()


class AlbumTagsUpdate(BaseModel):
    artist: str | None = None
    albumartist: str | None = None
    album: str | None = None
    date: str | None = None
    genre: str | None = None
    tracks: dict[str, dict[str, str]] = {}


class TrackTagsUpdate(BaseModel):
    model_config = {"extra": "allow"}


def _update_album_tags(request: Request, artist: str, album: str, data: AlbumTagsUpdate):
    _require_admin(request)
    lib = library_path()
    album_dir = safe_path(lib, f"{artist}/{album}")
    if not album_dir or not album_dir.is_dir():
        return JSONResponse({"error": "Not found"}, status_code=404)

    album_fields = {}
    for field in ["artist", "albumartist", "album", "date", "genre"]:
        val = getattr(data, field, None)
        if val is not None:
            album_fields[field] = val

    task_id = create_task("update_album_tags", {
        "artist_folder": artist,
        "album_folder": album,
        "album_fields": album_fields,
        "track_tags": data.tracks,
    })
    return {"task_id": task_id}


@router.put("/api/albums/{album_id}/tags")
def api_update_tags_by_id(request: Request, album_id: int, data: AlbumTagsUpdate):
    names = album_names_from_id(album_id)
    if not names:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return _update_album_tags(request, names[0], names[1], data)


def _update_track_tags(request: Request, filepath: str, data: TrackTagsUpdate):
    _require_admin(request)
    lib = library_path()
    track_path = safe_path(lib, filepath)
    if not track_path or not track_path.is_file():
        return JSONResponse({"error": "Not found"}, status_code=404)

    task_id = create_task("update_track_tags", {
        "filepath": filepath,
        "tags": data.model_dump(),
    })
    return {"task_id": task_id}


@router.put("/api/tracks/{track_id}/tags")
def api_update_track_tags_by_id(request: Request, track_id: int, data: TrackTagsUpdate):
    _require_admin(request)
    filepath = get_track_path_by_id(track_id)
    if not filepath:
        return JSONResponse({"error": "Not found"}, status_code=404)
    lib = library_path()
    lib_str = str(lib)
    if filepath.startswith(lib_str):
        filepath = filepath[len(lib_str):].lstrip("/")
    elif filepath.startswith("/music/"):
        filepath = filepath[len("/music/"):].lstrip("/")
    return _update_track_tags(request, filepath, data)
