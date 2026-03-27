from fastapi import APIRouter, Request
from pydantic import BaseModel

from musicdock.api.auth import _require_admin
from musicdock.db import create_task

router = APIRouter()


class BatchAlbumItem(BaseModel):
    artist: str
    album: str


class BatchRetagRequest(BaseModel):
    albums: list[BatchAlbumItem]


class BatchCoverItem(BaseModel):
    mbid: str | None = None
    path: str


class BatchFetchCoversRequest(BaseModel):
    albums: list[BatchCoverItem]


@router.post("/api/batch/retag")
def api_batch_retag(request: Request, data: BatchRetagRequest):
    """Queue a batch retag task."""
    _require_admin(request)
    albums = [{"artist": a.artist, "album": a.album} for a in data.albums]
    task_id = create_task("batch_retag", {"albums": albums})
    return {"status": "queued", "task_id": task_id, "count": len(albums)}


@router.post("/api/batch/fetch-covers")
def api_batch_fetch_covers(request: Request, data: BatchFetchCoversRequest):
    """Queue a batch cover fetch task."""
    _require_admin(request)
    albums = [{"mbid": a.mbid, "path": a.path} for a in data.albums]
    task_id = create_task("batch_covers", {"albums": albums})
    return {"status": "queued", "task_id": task_id, "count": len(albums)}
