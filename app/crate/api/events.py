import asyncio

from fastapi import APIRouter, Request
from starlette.responses import StreamingResponse

from crate.api.auth import _require_auth
from crate.db import list_tasks, get_latest_scan, get_task, get_task_events
from crate.api._deps import get_config, json_dumps
from crate.importer import ImportQueue

router = APIRouter()


# ── Global status stream ─────────────────────────────────────────

async def _event_stream():
    while True:
        running = list_tasks(status="running", limit=5)
        latest = get_latest_scan()
        recent_completed = list_tasks(status="completed", limit=5)

        config = get_config()
        try:
            queue = ImportQueue(config)
            pending_imports = len(queue.scan_pending())
        except Exception:
            pending_imports = 0

        def _parse_progress(raw):
            try:
                return json.loads(raw) if raw else {}
            except (json.JSONDecodeError, TypeError):
                return {"message": raw} if raw else {}

        data = {
            "tasks": [
                {
                    "id": t["id"], "type": t["type"], "status": t["status"],
                    "progress": _parse_progress(t["progress"]),
                }
                for t in running
            ],
            "last_scan": latest["scanned_at"] if latest else None,
            "issue_count": len(latest["issues"]) if latest else 0,
            "pending_imports": pending_imports,
            "recent_completed": [
                {"id": t["id"], "type": t["type"], "updated_at": t["updated_at"]}
                for t in recent_completed
            ],
        }

        yield f"data: {json_dumps(data)}\n\n"
        await asyncio.sleep(2)


@router.get("/api/events")
async def api_events(request: Request):
    _require_auth(request)
    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Per-task event stream ────────────────────────────────────────

async def _task_event_stream(task_id: str):
    """SSE stream for a specific task. Emits events as they arrive, closes when task completes."""
    last_event_id = 0

    while True:
        # Get new events since last seen
        events = get_task_events(task_id, after_id=last_event_id)
        for event in events:
            payload = {
                "id": event["id"],
                "type": event["event_type"],
                "data": event["data"],
                "timestamp": event["created_at"],
            }
            yield f"event: {event['event_type']}\ndata: {json_dumps(payload)}\n\n"
            last_event_id = event["id"]

        # Check if task is done
        task = get_task(task_id)
        if task and task["status"] in ("completed", "failed", "cancelled"):
            # Emit final status event
            yield f"event: task_done\ndata: {json_dumps({'status': task['status'], 'result': task.get('result'), 'error': task.get('error')})}\n\n"
            break

        await asyncio.sleep(1)


@router.get("/api/events/task/{task_id}")
async def api_task_events(request: Request, task_id: str):
    """SSE stream for a specific task's events. Closes when task completes."""
    _require_auth(request)
    return StreamingResponse(
        _task_event_stream(task_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
