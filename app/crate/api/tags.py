from fastapi import APIRouter, HTTPException, Request

from crate.api.auth import _require_admin
from crate.api._deps import album_names_from_id, library_path, safe_path
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.common import TaskEnqueueResponse
from crate.api.schemas.utility import AlbumTagsUpdate, TrackTagsUpdate
from crate.db import create_task, get_library_album_by_id, get_track_path_by_id

router = APIRouter(tags=["metadata"])

_TAG_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        404: error_response("The requested album or track could not be found."),
        422: error_response("The request payload failed validation."),
    },
)


def _update_album_tags(request: Request, artist: str, album: str, data: AlbumTagsUpdate):
    _require_admin(request)
    lib = library_path()
    album_dir = safe_path(lib, f"{artist}/{album}")
    if not album_dir or not album_dir.is_dir():
        raise HTTPException(status_code=404, detail="Not found")

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


@router.put(
    "/api/albums/{album_id}/tags",
    response_model=TaskEnqueueResponse,
    responses=_TAG_RESPONSES,
    summary="Queue an album-tag update",
)
def api_update_tags_by_id(request: Request, album_id: int, data: AlbumTagsUpdate):
    names = album_names_from_id(album_id)
    if not names:
        raise HTTPException(status_code=404, detail="Not found")
    return _update_album_tags(request, names[0], names[1], data)


def _update_track_tags(request: Request, filepath: str, data: TrackTagsUpdate):
    _require_admin(request)
    lib = library_path()
    track_path = safe_path(lib, filepath)
    if not track_path or not track_path.is_file():
        raise HTTPException(status_code=404, detail="Not found")

    task_id = create_task("update_track_tags", {
        "filepath": filepath,
        "tags": data.model_dump(),
    })
    return {"task_id": task_id}


@router.put(
    "/api/tracks/{track_id}/tags",
    response_model=TaskEnqueueResponse,
    responses=_TAG_RESPONSES,
    summary="Queue a track-tag update",
)
def api_update_track_tags_by_id(request: Request, track_id: int, data: TrackTagsUpdate):
    _require_admin(request)
    filepath = get_track_path_by_id(track_id)
    if not filepath:
        raise HTTPException(status_code=404, detail="Not found")
    lib = library_path()
    lib_str = str(lib)
    if filepath.startswith(lib_str):
        filepath = filepath[len(lib_str):].lstrip("/")
    elif filepath.startswith("/music/"):
        filepath = filepath[len("/music/"):].lstrip("/")
    return _update_track_tags(request, filepath, data)
