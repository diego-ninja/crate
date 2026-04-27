"""Domain-event and SSE diagnostics for admin ops snapshots."""

from __future__ import annotations

from typing import Any

from crate.db.admin_health_surface import HEALTH_SURFACE_STREAM_CHANNEL
from crate.db.admin_logs_surface import LOGS_SURFACE_STREAM_CHANNEL
from crate.db.admin_stack_surface import STACK_SNAPSHOT_SCOPE
from crate.db.admin_tasks_surface import TASKS_SURFACE_STREAM_CHANNEL
from crate.db.cache_runtime import _get_redis
from crate.db.domain_events import get_domain_event_runtime
from crate.db.snapshot_events import SNAPSHOT_CHANNEL_ALL, snapshot_channel

_CACHE_INVALIDATION_EVENTS_KEY = "cache:invalidation:events"
_CACHE_INVALIDATION_EVENT_ID_KEY = "cache:invalidation:next_id"


def _build_sse_surface_catalog() -> list[dict[str, str | None]]:
    return [
        {
            "name": "Global Task Feed",
            "endpoint": "/api/events",
            "channel": "crate:sse:global",
            "mode": "pubsub",
            "description": "Global status stream for running tasks and scan state.",
        },
        {
            "name": "Task Detail Feed",
            "endpoint": "/api/events/task/{task_id}",
            "channel": "crate:sse:task:{task_id}",
            "mode": "pubsub",
            "description": "Per-task SSE channel for progress and completion events.",
        },
        {
            "name": "Cache Invalidation Feed",
            "endpoint": "/api/cache/events",
            "channel": _CACHE_INVALIDATION_EVENTS_KEY,
            "mode": "replay",
            "description": "Replayable invalidation stream keyed by Last-Event-ID.",
        },
        {
            "name": "Admin Ops Snapshot",
            "endpoint": "/api/admin/ops-stream",
            "channel": snapshot_channel("ops", "dashboard"),
            "mode": "snapshot",
            "description": "Snapshot-driven updates for the admin dashboard.",
        },
        {
            "name": "Admin Tasks Surface",
            "endpoint": "/api/admin/tasks-stream",
            "channel": TASKS_SURFACE_STREAM_CHANNEL,
            "mode": "pubsub",
            "description": "Task surface refresh signals for the admin task queue.",
        },
        {
            "name": "Admin Health Surface",
            "endpoint": "/api/admin/health-stream",
            "channel": HEALTH_SURFACE_STREAM_CHANNEL,
            "mode": "pubsub",
            "description": "Health surface refresh signals for issue scans and repairs.",
        },
        {
            "name": "Admin Logs Surface",
            "endpoint": "/api/admin/logs-stream",
            "channel": LOGS_SURFACE_STREAM_CHANNEL,
            "mode": "pubsub",
            "description": "Worker log stream signals for operational log views.",
        },
        {
            "name": "Admin Stack Snapshot",
            "endpoint": "/api/admin/stack-stream",
            "channel": snapshot_channel(STACK_SNAPSHOT_SCOPE, "global"),
            "mode": "snapshot",
            "description": "Snapshot-driven stack updates for Docker/container status.",
        },
        {
            "name": "Home Discovery Snapshot",
            "endpoint": "/api/me/home/discovery-stream",
            "channel": snapshot_channel("home:discovery", "{user_id}"),
            "mode": "snapshot",
            "description": "Per-user discovery snapshot refreshes for listen home.",
        },
        {
            "name": "Snapshot Fanout",
            "endpoint": None,
            "channel": SNAPSHOT_CHANNEL_ALL,
            "mode": "snapshot",
            "description": "Global pub/sub channel fanout for snapshot scopes.",
        },
    ]


def build_eventing_payload() -> dict[str, Any]:
    redis = _get_redis()
    cache_invalidation = {
        "redis_connected": bool(redis),
        "events_key": _CACHE_INVALIDATION_EVENTS_KEY,
        "latest_event_id": 0,
        "retained_events": 0,
    }

    if redis:
        try:
            raw_latest = redis.get(_CACHE_INVALIDATION_EVENT_ID_KEY)
            cache_invalidation["latest_event_id"] = int(raw_latest) if raw_latest else 0
        except Exception:
            cache_invalidation["latest_event_id"] = 0
        try:
            cache_invalidation["retained_events"] = int(redis.llen(_CACHE_INVALIDATION_EVENTS_KEY) or 0)
        except Exception:
            cache_invalidation["retained_events"] = 0

    domain_events = get_domain_event_runtime(limit=8)
    return {
        "redis_connected": bool(redis),
        "domain_events": domain_events,
        "cache_invalidation": cache_invalidation,
        "sse_surfaces": _build_sse_surface_catalog(),
    }


__all__ = ["build_eventing_payload"]
