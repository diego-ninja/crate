import json as _json

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from musicdock.db import list_tasks, get_task, update_task, create_task

router = APIRouter()


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


@router.post("/api/tasks/{task_id}/cancel")
def api_cancel_task(task_id: str):
    task = get_task(task_id)
    if not task:
        return JSONResponse({"error": "Task not found"}, status_code=404)

    if task["status"] not in ("pending", "running"):
        return JSONResponse({"error": f"Cannot cancel task in '{task['status']}' status"}, status_code=400)

    update_task(task_id, status="cancelled")
    return {"status": "cancelled", "id": task_id}
