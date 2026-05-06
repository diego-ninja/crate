"""SSE event streams — global status + per-task events.

Uses Redis pub/sub to avoid DB polling. Each connected SSE client
subscribes to a Redis channel instead of repeatedly querying PostgreSQL.
Falls back to polling if Redis is unavailable.
"""

import asyncio
import json
from typing import AsyncIterator

from fastapi import APIRouter, Request
from starlette.responses import StreamingResponse

from crate.api._deps import json_dumps
from crate.api.auth import _require_auth
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, merge_responses
from crate.api.redis_sse import close_pubsub, open_pubsub
from crate.db.events import get_task_events
from crate.db.ops_snapshot import get_cached_ops_snapshot
from crate.db.queries.tasks import get_task

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
    """Build the global status payload from the ops/task snapshots."""
    ops_snapshot = get_cached_ops_snapshot()
    public_status = ops_snapshot.get("status", {})
    live = ops_snapshot.get("live") or {}
    recent = ops_snapshot.get("recent") or {}
    return {
        "tasks": [
            {
                "id": t["id"], "type": t["type"], "status": t.get("status", "running"),
                "label": t.get("label", ""),
                "progress": t.get("progress") or {},
            }
            for t in (live.get("running_tasks") or [])
        ],
        "last_scan": public_status.get("last_scan"),
        "issue_count": int(public_status.get("issue_count") or 0),
        "pending_imports": int(public_status.get("pending_imports") or 0),
        "recent_completed": [
            {
                "id": t["id"],
                "type": t["type"],
                "label": t.get("label", ""),
                "updated_at": t.get("updated_at"),
            }
            for t in (recent.get("tasks") or [])
            if t.get("status") == "completed"
        ],
    }


async def _global_stream_pubsub() -> AsyncIterator[str]:
    """Subscribe to Redis pub/sub for real-time updates. Falls back to polling."""
    # Send initial snapshot from DB
    yield f"data: {json_dumps(_get_status_snapshot())}\n\n"

    pubsub = None
    try:
        pubsub = await open_pubsub(REDIS_CHANNEL_GLOBAL)
        try:
            # Listen for published events, refresh snapshot on each
            async for message in pubsub.listen():
                if message["type"] == "message":
                    # Published event is a signal to refresh; build fresh snapshot
                    yield f"data: {json_dumps(_get_status_snapshot())}\n\n"
        finally:
            if pubsub is not None:
                await close_pubsub(pubsub, REDIS_CHANNEL_GLOBAL)
    except Exception:
        # Fallback: poll DB every 3s (same as before but less frequent)
        while True:
            yield f"data: {json_dumps(_get_status_snapshot())}\n\n"
            await asyncio.sleep(3)


async def _task_stream_pubsub(task_id: str) -> AsyncIterator[str]:
    """Subscribe to Redis channel for a specific task. Falls back to polling."""
    last_event_id = 0
    pubsub = None
    channel = f"{REDIS_CHANNEL_TASK_PREFIX}{task_id}"

    try:
        pubsub = await open_pubsub(channel)

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
            return

        try:
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
        finally:
            if pubsub is not None:
                await close_pubsub(pubsub, channel)

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
