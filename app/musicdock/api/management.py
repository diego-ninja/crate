from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from musicdock.api.auth import _require_admin
from musicdock.db import create_task, get_cache, get_audit_log

router = APIRouter(prefix="/api/manage", tags=["management"])


class DeleteRequest(BaseModel):
    mode: str = "db_only"  # "db_only" | "full"


class RepairRequest(BaseModel):
    dry_run: bool = True
    auto_only: bool = True


class MoveRequest(BaseModel):
    new_name: str


class WipeRequest(BaseModel):
    rebuild: bool = False


# ── Health Check & Repair ────────────────────────────────────────

@router.post("/health-check")
def run_health_check(request: Request):
    _require_admin(request)
    task_id = create_task("health_check")
    return {"task_id": task_id}


@router.get("/health-report")
def get_health_report(request: Request):
    _require_admin(request)
    report = get_cache("health_report")
    if not report:
        return {"issues": [], "summary": {}, "scanned_at": None}
    return report


@router.post("/repair")
def run_repair(request: Request, body: RepairRequest):
    _require_admin(request)
    task_id = create_task("repair", {"dry_run": body.dry_run, "auto_only": body.auto_only})
    return {"task_id": task_id}


class RepairIssuesRequest(BaseModel):
    issues: list[dict]
    dry_run: bool = False


@router.post("/repair-issues")
def repair_specific_issues(request: Request, body: RepairIssuesRequest):
    """Repair specific issues (individual or batch)."""
    _require_admin(request)
    task_id = create_task("repair", {
        "dry_run": body.dry_run,
        "auto_only": False,
        "issues": body.issues,
    })
    return {"task_id": task_id}


# ── Artist Management ────────────────────────────────────────────

@router.post("/artist/{name:path}/delete")
def delete_artist(request: Request, name: str, body: DeleteRequest):
    _require_admin(request)
    if body.mode not in ("db_only", "full"):
        raise HTTPException(status_code=422, detail="mode must be 'db_only' or 'full'")
    task_id = create_task("delete_artist", {"name": name, "mode": body.mode})
    return {"task_id": task_id}


@router.post("/artist/{name:path}/reset")
def reset_enrichment(request: Request, name: str):
    _require_admin(request)
    task_id = create_task("reset_enrichment", {"artist": name})
    return {"task_id": task_id}


@router.post("/artist/{name:path}/move")
def move_artist(request: Request, name: str, body: MoveRequest):
    _require_admin(request)
    if not body.new_name.strip():
        raise HTTPException(status_code=422, detail="new_name cannot be empty")
    task_id = create_task("move_artist", {"name": name, "new_name": body.new_name.strip()})
    return {"task_id": task_id}


# ── Album Management ────────────────────────────────────────────

@router.post("/album/{artist:path}/{album:path}/delete")
def delete_album(request: Request, artist: str, album: str, body: DeleteRequest):
    _require_admin(request)
    if body.mode not in ("db_only", "full"):
        raise HTTPException(status_code=422, detail="mode must be 'db_only' or 'full'")
    task_id = create_task("delete_album", {"artist": artist, "album": album, "mode": body.mode})
    return {"task_id": task_id}


# ── Library Management ───────────────────────────────────────────

@router.post("/wipe")
def wipe_library(request: Request, body: WipeRequest):
    _require_admin(request)
    task_id = create_task("wipe_library", {"rebuild": body.rebuild})
    return {"task_id": task_id}


@router.post("/rebuild")
def rebuild_library(request: Request):
    _require_admin(request)
    task_id = create_task("rebuild_library")
    return {"task_id": task_id}


# ── Bliss (song similarity) ──────────────────────────────────────

@router.post("/compute-bliss")
def compute_bliss(request: Request):
    _require_admin(request)
    task_id = create_task("compute_bliss")
    return {"task_id": task_id}


# ── Popularity ───────────────────────────────────────────────────

@router.post("/compute-popularity")
def compute_popularity(request: Request):
    _require_admin(request)
    task_id = create_task("compute_popularity")
    return {"task_id": task_id}


# ── MBID Enrichment ──────────────────────────────────────────────

@router.post("/enrich-mbids")
def enrich_mbids(request: Request, body: dict | None = None):
    _require_admin(request)
    params = {}
    if body:
        if body.get("artist"):
            params["artist"] = body["artist"]
        if body.get("min_score"):
            params["min_score"] = body["min_score"]
    task_id = create_task("enrich_mbids", params)
    return {"task_id": task_id}


# ── Audit Log ────────────────────────────────────────────────────

@router.get("/audit-log")
def read_audit_log(request: Request, limit: int = 100, offset: int = 0, action: str | None = None):
    _require_admin(request)
    entries, total = get_audit_log(limit=limit, offset=offset, action=action)
    return {"entries": entries, "total": total, "limit": limit, "offset": offset}
