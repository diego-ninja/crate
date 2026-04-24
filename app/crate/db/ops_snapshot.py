"""Snapshot builders for admin operational surfaces."""

from __future__ import annotations

from typing import Any

from crate.analysis_daemon import get_analysis_status as get_pipeline_analysis_status
from crate.db.cache_settings import get_setting
from crate.db.cache_store import get_cache
from crate.db.health import get_issue_counts
from crate.db.import_queue_read_models import count_import_queue_items
from crate.db.ops_runtime_views import DEFAULT_MAX_WORKERS, get_worker_live_state
from crate.db.repositories.library import get_library_stats
from crate.db.queries.management import (
    count_recent_active_users,
    count_recent_streams,
    get_last_analyzed_track,
    get_last_bliss_track,
)
from crate.db.queries.analytics import (
    get_avg_tracks_per_album,
    get_bitrate_distribution,
    get_decade_distribution,
    get_format_distribution,
    get_genre_distribution,
    get_sizes_by_format_gb,
    get_stats_analyzed_track_count,
    get_stats_avg_album_duration_min,
    get_stats_avg_bitrate,
    get_stats_duration_hours,
    get_stats_recent_albums,
    get_stats_top_genres,
    get_top_artists_by_albums,
    get_total_duration_hours,
)
from crate.db.ops_runtime import get_ops_runtime_state, set_ops_runtime_state
from crate.db.ui_snapshot_store import get_or_build_ui_snapshot
from crate.db.queries.shows import get_upcoming_shows
from crate.db.queries.tasks import get_latest_scan, list_tasks

_OPS_SNAPSHOT_SCOPE = "ops"
_OPS_SNAPSHOT_SUBJECT = "dashboard"
_OPS_SNAPSHOT_MAX_AGE = 15
_OPS_SNAPSHOT_STALE_MAX_AGE = 300


def _get_imports_pending_count() -> int:
    return count_import_queue_items(status="pending")


def _build_stats_payload() -> dict[str, Any]:
    stats = get_library_stats()
    scan = get_latest_scan()
    pending_imports = _get_imports_pending_count()
    worker_live = get_worker_live_state()
    pending_tasks = int(worker_live.get("pending_count") or 0) if worker_live else len(list_tasks(status="pending"))

    raw_albums = get_stats_recent_albums()
    recent_albums = [
        {
            "id": row["id"],
            "slug": row["slug"],
            "artist": row["artist"],
            "artist_id": row["artist_id"],
            "artist_slug": row["artist_slug"],
            "name": row["name"],
            "display_name": row["name"],
            "year": row["year"],
            "updated_at": row.get("updated_at"),
        }
        for row in raw_albums
    ]

    return {
        "artists": stats["artists"],
        "albums": stats["albums"],
        "tracks": stats["tracks"],
        "formats": stats["formats"],
        "total_size_gb": round(stats["total_size"] / (1024**3), 2) if stats["total_size"] else 0,
        "last_scan": scan["scanned_at"] if scan else None,
        "pending_imports": pending_imports,
        "pending_tasks": pending_tasks,
        "total_duration_hours": get_stats_duration_hours(),
        "avg_bitrate": get_stats_avg_bitrate(),
        "top_genres": get_stats_top_genres(),
        "recent_albums": recent_albums,
        "analyzed_tracks": get_stats_analyzed_track_count(),
        "avg_album_duration_min": get_stats_avg_album_duration_min(),
        "avg_tracks_per_album": round(get_avg_tracks_per_album() or 0, 1),
    }


def _build_analytics_payload() -> dict[str, Any]:
    return {
        "computing": False,
        "genres": get_genre_distribution(),
        "decades": get_decade_distribution(),
        "formats": get_format_distribution(),
        "bitrates": get_bitrate_distribution(),
        "top_artists": get_top_artists_by_albums(),
        "total_duration_hours": get_total_duration_hours(),
        "sizes_by_format_gb": get_sizes_by_format_gb(),
        "avg_tracks_per_album": get_avg_tracks_per_album(),
    }


def _build_live_activity_payload() -> dict[str, Any]:
    cached_live = get_worker_live_state()
    if cached_live:
        return cached_live

    running = list_tasks(status="running")
    pending = list_tasks(status="pending")
    recent = list_tasks(limit=10)
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
            "active": len(running),
        },
        "systems": {
            "postgres": True,
            "watcher": True,
        },
    }


def _build_recent_activity_payload() -> dict[str, Any]:
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


def _build_analysis_payload() -> dict[str, Any]:
    status = get_pipeline_analysis_status()
    return {
        **status,
        "last_analyzed": get_last_analyzed_track(),
        "last_bliss": get_last_bliss_track(),
    }


def _build_public_status_payload(live: dict[str, Any] | None = None) -> dict[str, Any]:
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


def _build_upcoming_shows_payload() -> list[dict[str, Any]]:
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
def build_ops_snapshot_payload() -> dict[str, Any]:
    stats = _build_stats_payload()
    analytics = _build_analytics_payload()
    live = _build_live_activity_payload()
    recent = _build_recent_activity_payload()
    analysis = _build_analysis_payload()
    status = _build_public_status_payload(live)
    payload = {
        "status": status,
        "stats": stats,
        "analytics": analytics,
        "live": live,
        "recent": recent,
        "analysis": analysis,
        "health_counts": get_issue_counts(),
        "upcoming_shows": _build_upcoming_shows_payload(),
        "runtime": {
            "active_users_5m": count_recent_active_users(),
            "streams_3m": count_recent_streams(),
        },
    }
    set_ops_runtime_state("public_status", status)
    set_ops_runtime_state("analysis_status", analysis)
    return payload


def get_cached_ops_snapshot(*, fresh: bool = False) -> dict[str, Any]:
    return get_or_build_ui_snapshot(
        scope=_OPS_SNAPSHOT_SCOPE,
        subject_key=_OPS_SNAPSHOT_SUBJECT,
        max_age_seconds=_OPS_SNAPSHOT_MAX_AGE,
        stale_max_age_seconds=_OPS_SNAPSHOT_STALE_MAX_AGE,
        fresh=fresh,
        allow_stale_on_error=True,
        build=build_ops_snapshot_payload,
    )


def get_public_status_snapshot() -> dict[str, Any]:
    cached = get_ops_runtime_state("public_status", max_age_seconds=30)
    if cached:
        return cached
    return get_cached_ops_snapshot().get("status", {})
