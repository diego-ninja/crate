from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from musicdock.api.auth import _require_admin
from musicdock.importer import ImportQueue
from musicdock.api._deps import get_config

router = APIRouter()


class ImportItemRequest(BaseModel):
    source_path: str
    artist: str | None = None
    album: str | None = None


class RemoveRequest(BaseModel):
    source_path: str


@router.get("/api/imports/pending")
def api_imports_pending(request: Request):
    _require_admin(request)
    config = get_config()
    queue = ImportQueue(config)
    pending = queue.scan_pending()
    return pending


@router.post("/api/imports/import")
def api_imports_import(request: Request, data: ImportItemRequest):
    _require_admin(request)
    config = get_config()
    queue = ImportQueue(config)
    result = queue.import_item(data.source_path, data.artist, data.album)
    return result


@router.post("/api/imports/import-all")
def api_imports_import_all(request: Request):
    _require_admin(request)
    config = get_config()
    queue = ImportQueue(config)
    results = queue.import_all()
    return results


@router.post("/api/imports/remove")
def api_imports_remove(request: Request, data: RemoveRequest):
    _require_admin(request)
    config = get_config()
    queue = ImportQueue(config)
    ok = queue.remove_source(data.source_path)
    return {"removed": ok}
