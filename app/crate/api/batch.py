from fastapi import APIRouter, Request

from crate.api.auth import _require_admin
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.operations import (
    BatchAlbumItem,
    BatchFetchCoversRequest,
    BatchRetagRequest,
    BatchTaskEnqueueResponse,
)
from crate.db import create_task

router = APIRouter(tags=["batch"])

_BATCH_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        422: error_response("The request payload failed validation."),
    },
)


@router.post(
    "/api/batch/retag",
    response_model=BatchTaskEnqueueResponse,
    responses=_BATCH_RESPONSES,
    summary="Queue batch retagging",
)
def api_batch_retag(request: Request, data: BatchRetagRequest):
    """Queue a batch retag task."""
    _require_admin(request)
    albums = [{"artist": a.artist, "album": a.album} for a in data.albums]
    task_id = create_task("batch_retag", {"albums": albums})
    return {"status": "queued", "task_id": task_id, "count": len(albums)}


@router.post(
    "/api/batch/fetch-covers",
    response_model=BatchTaskEnqueueResponse,
    responses=_BATCH_RESPONSES,
    summary="Queue batch cover fetching",
)
def api_batch_fetch_covers(request: Request, data: BatchFetchCoversRequest):
    """Queue a batch cover fetch task."""
    _require_admin(request)
    albums = [{"mbid": a.mbid, "path": a.path} for a in data.albums]
    task_id = create_task("batch_covers", {"albums": albums})
    return {"status": "queued", "task_id": task_id, "count": len(albums)}
