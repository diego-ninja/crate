"""SSE event streams — global status + per-task events.

Uses Redis pub/sub to avoid DB polling. Each connected SSE client
subscribes to a Redis channel instead of repeatedly querying PostgreSQL.
Falls back to polling if Redis is unavailable.
"""

import asyncio
import json
import os

from fastapi import APIRouter, Request
from starlette.responses import StreamingResponse

from crate.api.auth import _require_auth
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, merge_responses
from crate.db import list_tasks, get_latest_scan, get_task, get_task_events
from crate.api._deps import get_config, json_dumps

router = APIRouter(tags=["events"])

_EVENT_SSE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        200: {
            "description": "Server-sent events stream.",
            "content": {
                "text/event-stream": {
                    "schema": {
                        "type": "string",
                        "example": "data: {\"tasks\": []}\n\n",
                    }
                }
            },
        },
    },
)

REDIS_CHANNEL_GLOBAL = "crate:sse:global"
REDIS_CHANNEL_TASK_PREFIX = "crate:sse:task:"


def _get_status_snapshot() -> dict:
    """Build the global status payload from DB (used for initial snapshot)."""
    running = list_tasks(status="running", limit=5)
    latest = get_latest_scan()
    recent_completed = list_tasks(status="completed", limit=5)

    try:
        from crate.importer import ImportQueue
        config = get_config()
        queue = ImportQueue(config)
        pending_imports = len(queue.scan_pending())
    except Exception:
        pending_imports = 0

    def _parse_progress(raw):
        try:
            return json.loads(raw) if raw else {}
        except (json.JSONDecodeError, TypeError):
            return {"message": raw} if raw else {}

    return {
        "tasks": [
            {
                "id": t["id"], "type": t["type"], "status": t["status"],
                "label": t.get("label", ""),
                "progress": _parse_progress(t["progress"]),
            }
            for t in running
        ],
        "last_scan": latest["scanned_at"] if latest else None,
        "issue_count": len(latest["issues"]) if latest else 0,
        "pending_imports": pending_imports,
        "recent_completed": [
            {"id": t["id"], "type": t["type"], "label": t.get("label", ""), "updated_at": t["updated_at"]}
            for t in recent_completed
        ],
    }


def _get_redis_url() -> str:
    return os.environ.get("REDIS_URL", "redis://localhost:6379/0")


async def _global_stream_pubsub():
    """Subscribe to Redis pub/sub for real-time updates. Falls back to polling."""
    # Send initial snapshot from DB
    yield f"data: {json_dumps(_get_status_snapshot())}\n\n"

    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url(_get_redis_url(), decode_responses=True)
        pubsub = r.pubsub()
        await pubsub.subscribe(REDIS_CHANNEL_GLOBAL)

        # Listen for published events, refresh snapshot on each
        async for message in pubsub.listen():
            if message["type"] == "message":
                # Published event is a signal to refresh; build fresh snapshot
                yield f"data: {json_dumps(_get_status_snapshot())}\n\n"
    except Exception:
        # Fallback: poll DB every 3s (same as before but less frequent)
        while True:
            yield f"data: {json_dumps(_get_status_snapshot())}\n\n"
            await asyncio.sleep(3)


async def _task_stream_pubsub(task_id: str):
    """Subscribe to Redis channel for a specific task. Falls back to polling."""
    last_event_id = 0

    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url(_get_redis_url(), decode_responses=True)
        pubsub = r.pubsub()
        channel = f"{REDIS_CHANNEL_TASK_PREFIX}{task_id}"
        await pubsub.subscribe(channel)

        # Send any existing events first
        events = get_task_events(task_id, after_id=0, limit=50)
        for event in events:
            payload = {
                "id": event["id"], "type": event["event_type"],
                "data": event["data"], "timestamp": event["created_at"],
            }
            yield f"event: {event['event_type']}\ndata: {json_dumps(payload)}\n\n"
            last_event_id = event["id"]

        # Check if already done
        task = get_task(task_id)
        if task and task["status"] in ("completed", "failed", "cancelled"):
            yield f"event: task_done\ndata: {json_dumps({'status': task['status'], 'label': task.get('label', ''), 'result': task.get('result'), 'error': task.get('error')})}\n\n"
            await pubsub.unsubscribe(channel)
            await r.aclose()
            return

        # Listen for new events via pub/sub
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            try:
                data = json.loads(message["data"])
            except (json.JSONDecodeError, TypeError):
                continue

            if data.get("type") == "task_done":
                yield f"event: task_done\ndata: {json_dumps(data)}\n\n"
                break
            else:
                yield f"event: {data.get('event_type', 'info')}\ndata: {json_dumps(data)}\n\n"

        await pubsub.unsubscribe(channel)
        await r.aclose()

    except Exception:
        # Fallback: poll DB (original behavior)
        while True:
            events = get_task_events(task_id, after_id=last_event_id)
            for event in events:
                payload = {
                    "id": event["id"], "type": event["event_type"],
                    "data": event["data"], "timestamp": event["created_at"],
                }
                yield f"event: {event['event_type']}\ndata: {json_dumps(payload)}\n\n"
                last_event_id = event["id"]

            task = get_task(task_id)
            if task and task["status"] in ("completed", "failed", "cancelled"):
                yield f"event: task_done\ndata: {json_dumps({'status': task['status'], 'label': task.get('label', ''), 'result': task.get('result'), 'error': task.get('error')})}\n\n"
                break
            await asyncio.sleep(1)


# ── Endpoints ─────────────────────────────────────────────────────

@router.get(
    "/api/events",
    responses=_EVENT_SSE_RESPONSES,
    summary="Stream global task and scan events",
)
async def api_events(request: Request):
    _require_auth(request)
    return StreamingResponse(
        _global_stream_pubsub(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get(
    "/api/events/task/{task_id}",
    responses=_EVENT_SSE_RESPONSES,
    summary="Stream events for one task",
)
async def api_task_events(request: Request, task_id: str):
    _require_auth(request)
    return StreamingResponse(
        _task_stream_pubsub(task_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
