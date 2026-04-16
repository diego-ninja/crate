import json as _json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from crate.api.auth import _require_auth, _require_admin
from crate.db import list_tasks, get_task, update_task, create_task, get_setting, set_setting
from crate.docker_ctl import restart_container
from crate.scheduler import get_schedules, set_schedules

router = APIRouter()

DEFAULT_MAX_WORKERS = 5
DEFAULT_MIN_WORKERS = 2


@router.get("/api/tasks")
def api_tasks(request: Request, status: str | None = None, limit: int = 50):
    _require_auth(request)
    tasks = list_tasks(status=status, limit=limit)
    result = []
    for t in tasks:
        progress = t.get("progress", "")
        try:
            progress_parsed = _json.loads(progress) if progress and progress.startswith("{") else progress
        except (_json.JSONDecodeError, TypeError):
            progress_parsed = progress

        params_raw = t.get("params")
        try:
            params_parsed = _json.loads(params_raw) if isinstance(params_raw, str) and params_raw.startswith("{") else params_raw
        except (_json.JSONDecodeError, TypeError):
            params_parsed = params_raw

        result.append({
            "id": t["id"],
            "type": t["type"],
            "status": t["status"],
            "progress": progress_parsed,
            "error": t.get("error"),
            "result": t.get("result"),
            "params": params_parsed,
            "priority": t.get("priority", 2),
            "pool": t.get("pool", "default"),
            "created_at": t["created_at"],
            "started_at": t.get("started_at"),
            "updated_at": t["updated_at"],
        })
    return result


@router.post("/api/tasks/backfill-similarities")
def api_backfill_similarities(request: Request):
    """Populate artist_similarities table from existing similar_json data."""
    _require_admin(request)
    pending = list_tasks(status="pending", task_type="backfill_similarities", limit=1)
    running = list_tasks(status="running", task_type="backfill_similarities", limit=1)
    if pending or running:
        return JSONResponse({"error": "Already running"}, status_code=409)
    task_id = create_task("backfill_similarities")
    return {"task_id": task_id}


@router.post("/api/tasks/sync-shows")
def api_sync_shows(request: Request):
    """Trigger a sync_shows task to fetch shows from Ticketmaster into DB."""
    _require_admin(request)
    pending = list_tasks(status="pending", task_type="sync_shows", limit=1)
    running = list_tasks(status="running", task_type="sync_shows", limit=1)
    if pending or running:
        return JSONResponse({"error": "Already running"}, status_code=409)
    task_id = create_task("sync_shows")
    return {"task_id": task_id}


@router.post("/api/tasks/sync-library")
def api_sync_library(request: Request):
    """Create a library_sync task to re-sync the filesystem to DB."""
    _require_admin(request)
    running = list_tasks(status="running", task_type="library_sync", limit=1)
    pending = list_tasks(status="pending", task_type="library_sync", limit=1)
    if running or pending:
        return JSONResponse({"error": "Library sync already in progress"}, status_code=409)
    task_id = create_task("library_sync")
    return {"task_id": task_id, "status": "started"}


@router.get("/api/tasks/{task_id}")
def api_task_detail(request: Request, task_id: str):
    _require_auth(request)
    task = get_task(task_id)
    if not task:
        return JSONResponse({"error": "Task not found"}, status_code=404)

    progress = task.get("progress", "")
    try:
        progress_parsed = _json.loads(progress) if progress and progress.startswith("{") else progress
    except (_json.JSONDecodeError, TypeError):
        progress_parsed = progress

    return {
        "id": task["id"],
        "type": task["type"],
        "status": task["status"],
        "progress": progress_parsed,
        "error": task.get("error"),
        "result": task.get("result"),
        "created_at": task["created_at"],
        "updated_at": task["updated_at"],
    }


@router.get("/api/worker/status")
def api_worker_status(request: Request):
    """Get worker status: running/pending tasks, engine info."""
    _require_auth(request)
    from crate.db import get_cache
    running = list_tasks(status="running")
    pending = list_tasks(status="pending")

    # Service loop publishes status to cache
    cached_status = get_cache("worker_status") or {}

    return {
        "engine": cached_status.get("engine", "dramatiq"),
        "running": len(running),
        "pending": len(pending),
        "running_tasks": [{"id": t["id"], "type": t["type"], "pool": t.get("pool", "default")} for t in running],
        "pending_tasks": [{"id": t["id"], "type": t["type"], "pool": t.get("pool", "default")} for t in pending],
    }


@router.post("/api/worker/slots")
def api_set_worker_slots(request: Request, body: dict):
    """Set max/min worker slots. Workers read this on next poll."""
    _require_admin(request)
    slots = body.get("slots")
    min_slots = body.get("min_slots")
    if slots is not None:
        if not isinstance(slots, int) or slots < 1 or slots > 10:
            return JSONResponse({"error": "Slots must be 1-10"}, status_code=400)
        set_setting("max_workers", str(slots))
    if min_slots is not None:
        if not isinstance(min_slots, int) or min_slots < 1 or min_slots > 10:
            return JSONResponse({"error": "min_slots must be 1-10"}, status_code=400)
        set_setting("min_workers", str(min_slots))
    return {
        "max_slots": int(get_setting("max_workers", str(DEFAULT_MAX_WORKERS)) or DEFAULT_MAX_WORKERS),
        "min_slots": int(get_setting("min_workers", "2") or 2),
    }


@router.post("/api/worker/restart")
def api_restart_worker(request: Request):
    """Restart the worker container."""
    _require_admin(request)
    ok = restart_container("crate-worker")
    if ok:
        return {"status": "restarting"}
    return JSONResponse({"error": "Restart failed"}, status_code=500)


@router.post("/api/worker/cancel-all")
def api_cancel_all_tasks(request: Request):
    """Cancel all running and pending tasks."""
    _require_admin(request)
    running = list_tasks(status="running")
    pending = list_tasks(status="pending")
    cancelled = 0
    for t in running + pending:
        update_task(t["id"], status="cancelled")
        cancelled += 1
    return {"cancelled": cancelled}


@router.get("/api/worker/schedules")
def api_get_schedules(request: Request):
    """Get configured task schedules."""
    _require_auth(request)
    schedules = get_schedules()
    # Add last run times
    result = {}
    for task_type, interval in schedules.items():
        last_key = f"schedule:last_run:{task_type}"
        last_run = get_setting(last_key)
        result[task_type] = {
            "interval_seconds": interval,
            "interval_human": _format_interval(interval),
            "last_run": last_run,
            "enabled": interval > 0,
        }
    return result


@router.post("/api/worker/schedules")
def api_set_schedules(request: Request, body: dict):
    """Update task schedules. Body: {task_type: interval_seconds, ...}. Set to 0 to disable."""
    _require_admin(request)
    current = get_schedules()
    for k, v in body.items():
        if isinstance(v, (int, float)) and v >= 0:
            current[k] = int(v)
    set_schedules(current)
    return {"schedules": current}


def _format_interval(seconds: int) -> str:
    if seconds <= 0:
        return "disabled"
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m"
    if seconds < 86400:
        return f"{seconds // 3600}h"
    return f"{seconds // 86400}d"


@router.post("/api/tasks/clean/{status}")
def api_clean_tasks_by_status(request: Request, status: str):
    """Delete all tasks with the given status. Allowed: completed, cancelled, failed."""
    _require_admin(request)
    from fastapi import HTTPException
    from crate.db import delete_tasks_by_status
    allowed = {"completed", "cancelled", "failed"}
    if status not in allowed:
        raise HTTPException(status_code=400, detail=f"Status must be one of: {', '.join(allowed)}")
    deleted = delete_tasks_by_status(status)
    return {"deleted": deleted, "status": status}


@router.post("/api/tasks/cleanup")
def api_cleanup_tasks(request: Request, body: dict | None = None):
    """Delete completed/failed/cancelled tasks older than N days."""
    _require_admin(request)
    from crate.db import delete_old_finished_tasks
    from datetime import datetime, timezone, timedelta
    days = (body or {}).get("older_than_days", 7)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    deleted = delete_old_finished_tasks(cutoff)
    return {"deleted": deleted}


@router.post("/api/tasks/retry")
def api_retry_task(request: Request, body: dict):
    """Retry a failed task by creating a new one with the same type and params (dispatches to Dramatiq)."""
    _require_admin(request)
    task_id = body.get("task_id")
    if not task_id:
        return JSONResponse({"error": "task_id required"}, status_code=400)
    task = get_task(task_id)
    if not task:
        return JSONResponse({"error": "Task not found"}, status_code=404)

    params = task.get("params") or {}
    if isinstance(params, str):
        try:
            params = _json.loads(params)
        except (_json.JSONDecodeError, TypeError):
            params = {}

    new_id = create_task(task["type"], params)
    return {"task_id": new_id, "original_id": task_id}


@router.post("/api/tasks/{task_id}/cancel")
def api_cancel_task(request: Request, task_id: str):
    _require_admin(request)
    task = get_task(task_id)
    if not task:
        return JSONResponse({"error": "Task not found"}, status_code=404)

    if task["status"] not in ("pending", "running"):
        return JSONResponse({"error": f"Cannot cancel task in '{task['status']}' status"}, status_code=400)

    update_task(task_id, status="cancelled")
    return {"status": "cancelled", "id": task_id}
