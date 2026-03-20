from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from musicdock.db import create_task
from musicdock.api._deps import library_path, safe_path

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


@router.put("/api/tags/{artist:path}/{album:path}")
def api_update_tags(artist: str, album: str, data: AlbumTagsUpdate):
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


@router.put("/api/tags/track/{filepath:path}")
def api_update_track_tags(filepath: str, data: TrackTagsUpdate):
    lib = library_path()
    track_path = safe_path(lib, filepath)
    if not track_path or not track_path.is_file():
        return JSONResponse({"error": "Not found"}, status_code=404)

    task_id = create_task("update_track_tags", {
        "filepath": filepath,
        "tags": data.model_dump(),
    })
    return {"task_id": task_id}
