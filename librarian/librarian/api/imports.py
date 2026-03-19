from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from librarian.importer import ImportQueue
from librarian.api._deps import get_config

router = APIRouter()


class ImportItemRequest(BaseModel):
    source_path: str
    artist: str | None = None
    album: str | None = None


class RemoveRequest(BaseModel):
    source_path: str


@router.get("/api/imports/pending")
def api_imports_pending():
    config = get_config()
    queue = ImportQueue(config)
    pending = queue.scan_pending()
    return pending


@router.post("/api/imports/import")
def api_imports_import(data: ImportItemRequest):
    config = get_config()
    queue = ImportQueue(config)
    result = queue.import_item(data.source_path, data.artist, data.album)
    return result


@router.post("/api/imports/import-all")
def api_imports_import_all():
    config = get_config()
    queue = ImportQueue(config)
    results = queue.import_all()
    return results


@router.post("/api/imports/remove")
def api_imports_remove(data: RemoveRequest):
    config = get_config()
    queue = ImportQueue(config)
    ok = queue.remove_source(data.source_path)
    return {"removed": ok}
