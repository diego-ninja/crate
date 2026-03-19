from fastapi import APIRouter
from pydantic import BaseModel

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
def api_batch_retag(data: BatchRetagRequest):
    """Queue a batch retag task."""
    albums = [{"artist": a.artist, "album": a.album} for a in data.albums]
    task_id = create_task("batch_retag", {"albums": albums})
    return {"status": "queued", "task_id": task_id, "count": len(albums)}


@router.post("/api/batch/fetch-covers")
def api_batch_fetch_covers(data: BatchFetchCoversRequest):
    """Queue a batch cover fetch task."""
    albums = [{"mbid": a.mbid, "path": a.path} for a in data.albums]
    task_id = create_task("batch_covers", {"albums": albums})
    return {"status": "queued", "task_id": task_id, "count": len(albums)}
