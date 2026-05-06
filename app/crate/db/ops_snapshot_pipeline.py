"""Pipeline/analysis sections for ops snapshots."""

from __future__ import annotations

from typing import Any

from crate.db.import_queue_read_models import count_import_queue_items
from crate.db.health import get_issue_counts
from crate.db.ops_runtime import get_ops_runtime_state, set_ops_runtime_state
from crate.db.ops_runtime_views import get_worker_live_state
from crate.db.ops_snapshot_activity import (
    build_live_activity_payload,
    build_public_status_payload,
    build_recent_activity_payload,
    build_runtime_payload,
    build_upcoming_shows_payload,
)
from crate.db.ops_snapshot_eventing import build_eventing_payload
from crate.db.ops_snapshot_stats import build_analytics_payload, build_stats_payload
from crate.db.queries.analytics import get_overview_stat_summary, get_track_distribution_summary
from crate.db.queries.tasks import get_latest_scan
from crate.db.repositories.library import get_library_stats


def _empty_analysis_payload() -> dict[str, Any]:
    return {
        "total": 0,
        "analysis_done": 0,
        "analysis_pending": 0,
        "analysis_active": 0,
        "analysis_failed": 0,
        "bliss_done": 0,
        "bliss_pending": 0,
        "bliss_active": 0,
        "bliss_failed": 0,
        "fingerprint_done": 0,
        "fingerprint_pending": 0,
        "fingerprint_chromaprint": 0,
        "fingerprint_pcm": 0,
        "chromaprint_available": False,
        "fingerprint_strategy": "unknown",
        "last_analyzed": {},
        "last_bliss": {},
        "stale": True,
        "unavailable": True,
    }


def build_analysis_payload() -> dict[str, Any]:
    cached = get_ops_runtime_state("analysis_status", max_age_seconds=180)
    if cached:
        cached["stale"] = False
        return cached
    stale = get_ops_runtime_state("analysis_status")
    if stale:
        stale["stale"] = True
        return stale
    return _empty_analysis_payload()


def build_ops_snapshot_payload() -> dict[str, Any]:
    worker_live = get_worker_live_state()
    scan = get_latest_scan()
    pending_imports = count_import_queue_items(status="pending")
    library_stats = get_library_stats(include_formats=False)
    summary = get_overview_stat_summary()
    track_distributions = get_track_distribution_summary()

    stats = build_stats_payload(
        stats=library_stats,
        scan=scan,
        pending_imports=pending_imports,
        worker_live=worker_live,
        summary=summary,
        track_distributions=track_distributions,
    )
    analytics = build_analytics_payload(summary=summary, track_distributions=track_distributions)
    live = build_live_activity_payload(worker_live)
    recent = build_recent_activity_payload(worker_live=worker_live, scan=scan, pending_imports=pending_imports)
    analysis = build_analysis_payload()
    status = build_public_status_payload(live, scan=scan, pending_imports=pending_imports)
    payload = {
        "status": status,
        "stats": stats,
        "analytics": analytics,
        "live": live,
        "recent": recent,
        "analysis": analysis,
        "health_counts": get_issue_counts(),
        "upcoming_shows": build_upcoming_shows_payload(),
        "runtime": build_runtime_payload(),
        "eventing": build_eventing_payload(),
    }
    set_ops_runtime_state("public_status", status)
    return payload


__all__ = ["build_analysis_payload", "build_ops_snapshot_payload"]
