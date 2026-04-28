"""Activity/live/public sections for ops snapshots."""

from __future__ import annotations

from typing import Any

from crate.db.cache_settings import get_setting
from crate.db.cache_store import get_cache
from crate.db.import_queue_read_models import count_import_queue_items
from crate.db.ops_runtime import get_ops_runtime_state
from crate.db.ops_runtime_views import DEFAULT_MAX_WORKERS, get_worker_live_state
from crate.db.queries.management import count_recent_active_users, count_recent_streams
from crate.db.queries.shows import get_upcoming_shows
from crate.db.queries.tasks import get_latest_scan, get_task_activity_snapshot, list_tasks


def _get_imports_pending_count() -> int:
    return count_import_queue_items(status="pending")


def build_live_activity_payload() -> dict[str, Any]:
    cached_live = get_worker_live_state()
    if cached_live:
        return cached_live

    activity = get_task_activity_snapshot(running_limit=100, pending_limit=100, recent_limit=10)
    running = activity["running_tasks"]
    pending = activity["pending_tasks"]
    recent = activity["recent_tasks"]
    max_workers = int(get_setting("max_workers", str(DEFAULT_MAX_WORKERS)) or DEFAULT_MAX_WORKERS)
    cached_status = get_cache("worker_status") or {}
    return {
        "engine": cached_status.get("engine", "dramatiq"),
        "running_tasks": [
            {
                "id": task["id"],
                "type": task["type"],
                "status": task["status"],
                "pool": task.get("pool", "default"),
                "progress": task.get("progress", ""),
                "created_at": task.get("created_at"),
                "started_at": task.get("started_at"),
                "updated_at": task.get("updated_at"),
            }
            for task in running
        ],
        "pending_tasks": [
            {
                "id": task["id"],
                "type": task["type"],
                "status": task["status"],
                "pool": task.get("pool", "default"),
                "progress": task.get("progress", ""),
                "created_at": task.get("created_at"),
                "started_at": task.get("started_at"),
                "updated_at": task.get("updated_at"),
            }
            for task in pending[:12]
        ],
        "recent_tasks": [
            {
                "id": task["id"],
                "type": task["type"],
                "status": task["status"],
                "updated_at": task["updated_at"],
            }
            for task in recent
        ],
        "worker_slots": {
            "max": max_workers,
            "active": int(activity["running_count"]),
        },
        "systems": {
            "postgres": True,
            "watcher": True,
        },
    }


def build_recent_activity_payload() -> dict[str, Any]:
    worker_live = get_worker_live_state()
    tasks = worker_live.get("recent_tasks") if worker_live else list_tasks(limit=10)
    scan = get_latest_scan()
    return {
        "tasks": [
            {
                "id": task["id"],
                "type": task["type"],
                "status": task["status"],
                "created_at": task.get("created_at"),
                "updated_at": task.get("updated_at"),
            }
            for task in tasks
        ],
        "pending_imports": _get_imports_pending_count(),
        "last_scan": scan["scanned_at"] if scan else None,
    }


def build_public_status_payload(live: dict[str, Any] | None = None) -> dict[str, Any]:
    scan = get_latest_scan()
    worker_live = live or get_worker_live_state()
    if worker_live:
        scan_live = worker_live.get("scan") or {}
        running_scan = bool(scan_live.get("running"))
        progress = scan_live.get("progress") or {}
    else:
        running_scan_rows = list_tasks(status="running", task_type="scan", limit=1)
        running_scan = len(running_scan_rows) > 0
        progress = running_scan_rows[0].get("progress", {}) if running_scan_rows else {}
    return {
        "scanning": running_scan,
        "last_scan": scan["scanned_at"] if scan else None,
        "issue_count": len(scan["issues"]) if scan else 0,
        "progress": progress,
        "pending_imports": _get_imports_pending_count(),
        "running_tasks": len((worker_live or {}).get("running_tasks") or []),
    }


def build_upcoming_shows_payload() -> list[dict[str, Any]]:
    shows = get_upcoming_shows(limit=5)
    return [
        {
            "artist_name": show.get("artist_name"),
            "venue": show.get("venue"),
            "city": show.get("city"),
            "country": show.get("country"),
            "date": show.get("date"),
            "url": show.get("url"),
        }
        for show in shows
    ]


def build_runtime_payload() -> dict[str, Any]:
    return {
        "active_users_5m": count_recent_active_users(),
        "streams_3m": count_recent_streams(),
    }


def get_public_status_snapshot() -> dict[str, Any]:
    cached = get_ops_runtime_state("public_status", max_age_seconds=30)
    if cached:
        return cached
    return {}


__all__ = [
    "build_live_activity_payload",
    "build_public_status_payload",
    "build_recent_activity_payload",
    "build_runtime_payload",
    "build_upcoming_shows_payload",
    "get_public_status_snapshot",
]
