from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from musicdock.api._deps import get_config
from musicdock.db import create_task, get_task, list_tasks, get_latest_scan

router = APIRouter()


class ScanRequest(BaseModel):
    only: str | None = None


class FixRequest(BaseModel):
    dry_run: bool = True


@router.post("/api/scan")
def start_scan(body: ScanRequest | None = None):
    running = list_tasks(status="running", task_type="scan", limit=1)
    if running:
        return JSONResponse({"error": "Scan already in progress"}, status_code=409)

    params = {}
    if body and body.only:
        params["only"] = body.only

    task_id = create_task("scan", params)
    return {"status": "started", "task_id": task_id, "only": params.get("only")}


@router.get("/api/status")
def api_status():
    import json as _json

    running = list_tasks(status="running", task_type="scan", limit=1)
    scanning = len(running) > 0

    progress_raw = running[0]["progress"] if running else ""
    try:
        progress = _json.loads(progress_raw) if progress_raw else {}
    except (_json.JSONDecodeError, TypeError):
        progress = {"message": progress_raw} if progress_raw else {}

    latest = get_latest_scan()
    last_scan = latest["scanned_at"] if latest else None
    issue_count = len(latest["issues"]) if latest else 0

    return {
        "scanning": scanning,
        "last_scan": last_scan,
        "issue_count": issue_count,
        "progress": progress,
    }


@router.get("/api/issues")
def api_issues(type: str | None = None):
    latest = get_latest_scan()
    if not latest:
        return []

    issues = latest["issues"]
    if type:
        issues = [i for i in issues if i.get("type") == type]
    return issues


@router.post("/api/fix")
def fix_issues(body: FixRequest | None = None):
    dry_run = body.dry_run if body else True

    running = list_tasks(status="running", task_type="scan", limit=1)
    if running:
        return JSONResponse({"error": "Scan in progress"}, status_code=409)

    latest = get_latest_scan()
    if not latest or not latest["issues"]:
        return JSONResponse({"error": "No issues to fix. Run a scan first."}, status_code=400)

    config = get_config()
    threshold = config.get("confidence_threshold", 90)
    issues = latest["issues"]

    auto = [i for i in issues if i.get("confidence", 0) >= threshold]
    manual = [i for i in issues if i.get("confidence", 0) < threshold]

    if not dry_run:
        task_id = create_task("fix_issues", {"threshold": threshold})
        return {
            "dry_run": False,
            "threshold": threshold,
            "auto_fixable": len(auto),
            "needs_review": len(manual),
            "task_id": task_id,
        }

    return {
        "dry_run": dry_run,
        "threshold": threshold,
        "auto_fixable": len(auto),
        "needs_review": len(manual),
    }
