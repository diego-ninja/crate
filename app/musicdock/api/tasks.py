import json as _json

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from musicdock.db import list_tasks, get_task, update_task, create_task, get_setting, set_setting
from musicdock.docker_ctl import restart_container
from musicdock.scheduler import get_schedules, set_schedules

router = APIRouter()

DEFAULT_MAX_WORKERS = 3


@router.get("/api/tasks")
def api_tasks(status: str | None = None, limit: int = 50):
    tasks = list_tasks(status=status, limit=limit)
    result = []
    for t in tasks:
        progress = t.get("progress", "")
        try:
            progress_parsed = _json.loads(progress) if progress and progress.startswith("{") else progress
        except (_json.JSONDecodeError, TypeError):
            progress_parsed = progress

        result.append({
            "id": t["id"],
            "type": t["type"],
            "status": t["status"],
            "progress": progress_parsed,
            "error": t.get("error"),
            "result": t.get("result"),
            "created_at": t["created_at"],
            "updated_at": t["updated_at"],
        })
    return result


@router.get("/api/tasks/{task_id}")
def api_task_detail(task_id: str):
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


@router.post("/api/tasks/sync-library")
def api_sync_library():
    """Create a library_sync task to re-sync the filesystem to DB."""
    running = list_tasks(status="running", task_type="library_sync", limit=1)
    pending = list_tasks(status="pending", task_type="library_sync", limit=1)
    if running or pending:
        return JSONResponse({"error": "Library sync already in progress"}, status_code=409)
    task_id = create_task("library_sync")
    return {"status": "started", "task_id": task_id}


@router.get("/api/worker/status")
def api_worker_status():
    """Get worker status: slots, running/pending tasks."""
    running = list_tasks(status="running")
    pending = list_tasks(status="pending")
    max_workers = int(get_setting("max_workers", str(DEFAULT_MAX_WORKERS)) or DEFAULT_MAX_WORKERS)
    return {
        "max_slots": max_workers,
        "running": len(running),
        "pending": len(pending),
        "running_tasks": [{"id": t["id"], "type": t["type"]} for t in running],
        "pending_tasks": [{"id": t["id"], "type": t["type"]} for t in pending],
    }


@router.post("/api/worker/slots")
def api_set_worker_slots(body: dict):
    """Set max worker slots (1-5). Worker reads this on next poll."""
    slots = body.get("slots", DEFAULT_MAX_WORKERS)
    if not isinstance(slots, int) or slots < 1 or slots > 5:
        return JSONResponse({"error": "Slots must be 1-5"}, status_code=400)
    set_setting("max_workers", str(slots))
    return {"max_slots": slots}


@router.post("/api/worker/restart")
def api_restart_worker():
    """Restart the worker container."""
    ok = restart_container("musicdock-worker")
    if ok:
        return {"status": "restarting"}
    return JSONResponse({"error": "Restart failed"}, status_code=500)


@router.post("/api/worker/cancel-all")
def api_cancel_all_tasks():
    """Cancel all running and pending tasks."""
    running = list_tasks(status="running")
    pending = list_tasks(status="pending")
    cancelled = 0
    for t in running + pending:
        update_task(t["id"], status="cancelled")
        cancelled += 1
    return {"cancelled": cancelled}


@router.get("/api/worker/schedules")
def api_get_schedules():
    """Get configured task schedules."""
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
def api_set_schedules(body: dict):
    """Update task schedules. Body: {task_type: interval_seconds, ...}. Set to 0 to disable."""
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


@router.post("/api/tasks/{task_id}/cancel")
def api_cancel_task(task_id: str):
    task = get_task(task_id)
    if not task:
        return JSONResponse({"error": "Task not found"}, status_code=404)

    if task["status"] not in ("pending", "running"):
        return JSONResponse({"error": f"Cannot cancel task in '{task['status']}' status"}, status_code=400)

    update_task(task_id, status="cancelled")
    return {"status": "cancelled", "id": task_id}
