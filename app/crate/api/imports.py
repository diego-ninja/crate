from fastapi import APIRouter, Request

from crate.api.auth import _require_admin
from crate.importer import ImportQueue
from crate.api._deps import get_config
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.schemas.utility import (
    ImportItemRequest,
    ImportPendingResponse,
    ImportRemoveRequest,
    ImportRemoveResponse,
    ImportResultResponse,
    ImportResultsResponse,
)

router = APIRouter(tags=["imports"])


@router.get(
    "/api/imports/pending",
    response_model=ImportPendingResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List pending filesystem imports",
)
def api_imports_pending(request: Request):
    _require_admin(request)
    config = get_config()
    queue = ImportQueue(config)
    pending = queue.scan_pending()
    return pending


@router.post(
    "/api/imports/import",
    response_model=ImportResultResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Import one pending album into the library",
)
def api_imports_import(request: Request, data: ImportItemRequest):
    _require_admin(request)
    config = get_config()
    queue = ImportQueue(config)
    result = queue.import_item(data.source_path, data.artist, data.album)
    return result


@router.post(
    "/api/imports/import-all",
    response_model=ImportResultsResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Import all pending albums",
)
def api_imports_import_all(request: Request):
    _require_admin(request)
    config = get_config()
    queue = ImportQueue(config)
    results = queue.import_all()
    return results


@router.post(
    "/api/imports/remove",
    response_model=ImportRemoveResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Remove a staged import source directory",
)
def api_imports_remove(request: Request, data: ImportRemoveRequest):
    _require_admin(request)
    config = get_config()
    queue = ImportQueue(config)
    ok = queue.remove_source(data.source_path)
    return {"removed": ok}
