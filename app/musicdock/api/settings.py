import json

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from musicdock.api.auth import _require_admin
from musicdock.db import get_setting, set_setting, get_db_table_stats, get_db_ctx
from musicdock.scheduler import get_schedules, set_schedules
from musicdock import navidrome

router = APIRouter(prefix="/api/settings", tags=["settings"])

VALID_ENRICHMENT_SOURCES = {"lastfm", "spotify", "fanart", "setlistfm", "musicbrainz"}
DEFAULT_ENRICHMENT = '{"lastfm":true,"spotify":true,"fanart":true,"setlistfm":true,"musicbrainz":true}'


class WorkerSettings(BaseModel):
    max_workers: int


class CacheClearRequest(BaseModel):
    type: str


@router.get("")
def get_settings(request: Request):
    _require_admin(request)
    return {
        "schedules": get_schedules(),
        "worker": {"max_workers": int(get_setting("max_workers", "5"))},
        "enrichment": json.loads(get_setting("enrichment_sources", DEFAULT_ENRICHMENT)),
        "navidrome": {
            "connected": navidrome.ping(),
            "version": navidrome.get_server_version(),
        },
        "db_stats": get_db_table_stats(),
    }


@router.put("/schedules")
def update_schedules(request: Request, body: dict[str, int]):
    _require_admin(request)
    for key, val in body.items():
        if not isinstance(val, int) or val < 0:
            raise HTTPException(status_code=422, detail=f"Invalid interval for '{key}': must be int >= 0")
    set_schedules(body)
    return {"ok": True}


@router.put("/worker")
def update_worker(request: Request, body: WorkerSettings):
    _require_admin(request)
    if body.max_workers < 1 or body.max_workers > 10:
        raise HTTPException(status_code=422, detail="max_workers must be between 1 and 10")
    set_setting("max_workers", str(body.max_workers))
    return {"ok": True}


@router.put("/enrichment")
def update_enrichment(request: Request, body: dict[str, bool]):
    _require_admin(request)
    invalid = set(body.keys()) - VALID_ENRICHMENT_SOURCES
    if invalid:
        raise HTTPException(status_code=422, detail=f"Invalid sources: {', '.join(sorted(invalid))}")
    set_setting("enrichment_sources", json.dumps(body))
    return {"ok": True}


@router.post("/navidrome/test")
def test_navidrome(request: Request):
    _require_admin(request)
    return {
        "connected": navidrome.ping(),
        "version": navidrome.get_server_version(),
    }


@router.post("/cache/clear")
def clear_cache(request: Request, body: CacheClearRequest):
    _require_admin(request)
    cache_type = body.type
    valid_types = {"all", "enrichment", "lastfm", "analytics"}
    if cache_type not in valid_types:
        raise HTTPException(status_code=422, detail=f"Invalid cache type: must be one of {', '.join(sorted(valid_types))}")

    with get_db_ctx() as cur:
        if cache_type == "all":
            cur.execute("DELETE FROM cache")
            cur.execute("DELETE FROM mb_cache")
        elif cache_type == "enrichment":
            cur.execute("DELETE FROM cache WHERE key LIKE 'enrichment:%%'")
        elif cache_type == "lastfm":
            cur.execute("DELETE FROM cache WHERE key LIKE 'lastfm:%%'")
        elif cache_type == "analytics":
            cur.execute("DELETE FROM cache WHERE key IN ('analytics', 'stats')")

    return {"ok": True, "type": cache_type}
