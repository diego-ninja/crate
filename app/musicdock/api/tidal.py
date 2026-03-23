from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from musicdock.api.auth import _require_auth, _require_admin
from musicdock.db import create_task
from musicdock import tidal

router = APIRouter(prefix="/api/tidal", tags=["tidal"])


class DownloadRequest(BaseModel):
    url: str
    quality: str = "max"


# ── Auth ─────────────────────────────────────────────────────────

@router.get("/status")
def tidal_status(request: Request):
    _require_auth(request)
    return {
        "authenticated": tidal.is_authenticated(),
    }


# ── Search ───────────────────────────────────────────────────────

@router.get("/search")
def tidal_search(request: Request, q: str = "", type: str = "all", limit: int = 20, offset: int = 0):
    _require_auth(request)
    if len(q.strip()) < 2:
        return {"albums": [], "artists": [], "tracks": []}
    result = tidal.search(q, content_type=type, limit=limit, offset=offset)
    if "error" in result:
        raise HTTPException(status_code=502, detail=result["error"])
    return result


# ── Download ─────────────────────────────────────────────────────

@router.post("/download")
def tidal_download(request: Request, body: DownloadRequest):
    _require_auth(request)
    if not tidal.is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated with Tidal")
    if not body.url.strip():
        raise HTTPException(status_code=422, detail="URL is required")
    task_id = create_task("tidal_download", {
        "url": body.url.strip(),
        "quality": body.quality,
    })
    return {"task_id": task_id}
