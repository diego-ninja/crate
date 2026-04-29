"""Shared views over persisted operational runtime state."""

from __future__ import annotations

from crate.db.cache_settings import get_setting
from crate.db.ops_runtime import get_ops_runtime_state

DEFAULT_MAX_WORKERS = 3
DEFAULT_QUEUE_BREAKDOWN = {
    "running": {"fast": 0, "default": 0, "heavy": 0},
    "pending": {"fast": 0, "default": 0, "heavy": 0},
}
DEFAULT_DB_HEAVY_GATE = {"active": 0, "pending": 0, "blocking": False}


def get_worker_live_state(*, max_age_seconds: int = 30) -> dict | None:
    cached = get_ops_runtime_state("worker_live", max_age_seconds=max_age_seconds)
    if not cached:
        return None
    running_tasks = list(cached.get("running_tasks") or [])
    pending_tasks = list(cached.get("pending_tasks") or [])
    return {
        "engine": cached.get("engine", "dramatiq"),
        "running_count": int(cached.get("running_count") or len(running_tasks)),
        "pending_count": int(cached.get("pending_count") or len(pending_tasks)),
        "running_tasks": running_tasks,
        "pending_tasks": pending_tasks,
        "recent_tasks": list(cached.get("recent_tasks") or []),
        "worker_slots": cached.get("worker_slots") or {
            "max": int(get_setting("max_workers", str(DEFAULT_MAX_WORKERS)) or DEFAULT_MAX_WORKERS),
            "active": len(running_tasks),
        },
        "queue_breakdown": cached.get("queue_breakdown") or DEFAULT_QUEUE_BREAKDOWN,
        "db_heavy_gate": cached.get("db_heavy_gate") or DEFAULT_DB_HEAVY_GATE,
        "scan": cached.get("scan") or {"running": False, "progress": {}},
        "systems": cached.get("systems") or {"postgres": True, "watcher": True},
    }


__all__ = [
    "DEFAULT_DB_HEAVY_GATE",
    "DEFAULT_MAX_WORKERS",
    "DEFAULT_QUEUE_BREAKDOWN",
    "get_worker_live_state",
]
