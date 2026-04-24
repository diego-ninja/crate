from fastapi import APIRouter, Request

from crate.api.auth import _require_admin
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.schemas.common import TaskEnqueueResponse
from crate.api.schemas.utility import (
    ImportItemRequest,
    ImportPendingResponse,
    ImportRemoveRequest,
)
from crate.db.import_queue_read_models import (
    list_import_queue_items,
)
from crate.db.repositories.tasks import create_task

router = APIRouter(tags=["imports"])


@router.get(
    "/api/imports/pending",
    response_model=ImportPendingResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List pending filesystem imports",
)
def api_imports_pending(request: Request):
    _require_admin(request)
    return list_import_queue_items(status="pending")


@router.post(
    "/api/imports/import",
    response_model=TaskEnqueueResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Queue import of one staged album into the library",
)
def api_imports_import(request: Request, data: ImportItemRequest):
    _require_admin(request)
    task_id = create_task(
        "import_queue_item",
        {
            "source_path": data.source_path,
            "artist": data.artist,
            "album": data.album,
        },
    )
    return {"task_id": task_id, "status": "queued"}


@router.post(
    "/api/imports/import-all",
    response_model=TaskEnqueueResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Queue import of all pending staged albums",
)
def api_imports_import_all(request: Request):
    _require_admin(request)
    task_id = create_task("import_queue_all", {})
    return {"task_id": task_id, "status": "queued"}


@router.post(
    "/api/imports/remove",
    response_model=TaskEnqueueResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Queue removal of a staged import source directory",
)
def api_imports_remove(request: Request, data: ImportRemoveRequest):
    _require_admin(request)
    task_id = create_task(
        "import_queue_remove",
        {
            "source_path": data.source_path,
        },
    )
    return {"task_id": task_id, "status": "queued"}
