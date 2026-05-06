"""Snapshot builders for admin task surfaces."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from crate.db.cache_runtime import _get_redis
from crate.db.ops_runtime_views import DEFAULT_MAX_WORKERS, get_worker_live_state
from crate.db.ui_snapshot_store import get_or_build_ui_snapshot
from crate.db.queries.tasks import get_task_activity_snapshot, list_tasks

TASKS_SNAPSHOT_SCOPE = "ops:tasks"
TASKS_SNAPSHOT_MAX_AGE = 30
TASKS_SNAPSHOT_STALE_MAX_AGE = 120
TASKS_SURFACE_STREAM_CHANNEL = "crate:sse:admin:tasks"


def _parse_jsonish(value: Any) -> Any:
    if isinstance(value, str) and value[:1] in {"{", "["}:
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def serialize_task_surface(task: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": task["id"],
        "type": task["type"],
        "status": task["status"],
        "label": task.get("label"),
        "progress": _parse_jsonish(task.get("progress", "")),
        "error": task.get("error"),
        "result": task.get("result"),
        "params": _parse_jsonish(task.get("params")),
        "priority": task.get("priority", 2),
        "pool": task.get("pool", "default"),
        "created_at": task.get("created_at"),
        "started_at": task.get("started_at"),
        "updated_at": task.get("updated_at"),
    }


def build_tasks_surface_payload(limit: int = 100) -> dict[str, Any]:
    worker_live = get_worker_live_state()
    if worker_live:
        live = {
            "engine": worker_live["engine"],
            "running_tasks": worker_live["running_tasks"],
            "pending_tasks": worker_live["pending_tasks"],
            "recent_tasks": worker_live["recent_tasks"],
            "worker_slots": worker_live["worker_slots"],
            "queue_breakdown": worker_live.get("queue_breakdown"),
            "db_heavy_gate": worker_live.get("db_heavy_gate"),
            "systems": worker_live["systems"],
        }
    else:
        activity = get_task_activity_snapshot(running_limit=25, pending_limit=25, recent_limit=10)
        running = activity["running_tasks"]
        pending = activity["pending_tasks"]
        recent = activity["recent_tasks"]
        live = {
            "engine": "dramatiq",
            "running_tasks": [serialize_task_surface(task) for task in running],
            "pending_tasks": [serialize_task_surface(task) for task in pending],
            "recent_tasks": [
                {
                    "id": task["id"],
                    "type": task["type"],
                    "status": task["status"],
                    "updated_at": task.get("updated_at"),
                }
                for task in recent
            ],
            "worker_slots": {
                "max": DEFAULT_MAX_WORKERS,
                "active": int(activity["running_count"]),
            },
            "queue_breakdown": activity["queue_breakdown"],
            "db_heavy_gate": activity["db_heavy_gate"],
            "systems": {"postgres": True, "watcher": True},
        }

    history = [serialize_task_surface(task) for task in list_tasks(limit=limit)]
    return {"live": live, "history": history}


def get_cached_tasks_surface(*, limit: int = 100, fresh: bool = False) -> dict[str, Any]:
    safe_limit = min(max(int(limit or 100), 1), 200)
    return get_or_build_ui_snapshot(
        scope=TASKS_SNAPSHOT_SCOPE,
        subject_key=f"surface:{safe_limit}",
        max_age_seconds=TASKS_SNAPSHOT_MAX_AGE,
        stale_max_age_seconds=TASKS_SNAPSHOT_STALE_MAX_AGE,
        fresh=fresh,
        allow_stale_on_error=True,
        build=lambda: build_tasks_surface_payload(safe_limit),
    )


def publish_tasks_surface_signal() -> None:
    try:
        redis = _get_redis()
        if not redis:
            return
        payload = json.dumps(
            {
                "kind": "tasks",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
        redis.publish(TASKS_SURFACE_STREAM_CHANNEL, payload)
    except Exception:
        return


__all__ = [
    "TASKS_SNAPSHOT_SCOPE",
    "TASKS_SNAPSHOT_MAX_AGE",
    "TASKS_SNAPSHOT_STALE_MAX_AGE",
    "TASKS_SURFACE_STREAM_CHANNEL",
    "build_tasks_surface_payload",
    "get_cached_tasks_surface",
    "publish_tasks_surface_signal",
    "serialize_task_surface",
]
