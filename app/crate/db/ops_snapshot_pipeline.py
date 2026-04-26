"""Pipeline/analysis sections for ops snapshots."""

from __future__ import annotations

from typing import Any

from crate.analysis_daemon import get_analysis_status as get_pipeline_analysis_status
from crate.db.health import get_issue_counts
from crate.db.ops_runtime import set_ops_runtime_state
from crate.db.ops_snapshot_activity import (
    build_live_activity_payload,
    build_public_status_payload,
    build_recent_activity_payload,
    build_runtime_payload,
    build_upcoming_shows_payload,
)
from crate.db.ops_snapshot_stats import build_analytics_payload, build_stats_payload
from crate.db.queries.management import get_last_analyzed_track, get_last_bliss_track


def build_analysis_payload() -> dict[str, Any]:
    status = get_pipeline_analysis_status()
    return {
        **status,
        "last_analyzed": get_last_analyzed_track(),
        "last_bliss": get_last_bliss_track(),
    }


def build_ops_snapshot_payload() -> dict[str, Any]:
    stats = build_stats_payload()
    analytics = build_analytics_payload()
    live = build_live_activity_payload()
    recent = build_recent_activity_payload()
    analysis = build_analysis_payload()
    status = build_public_status_payload(live)
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
    }
    set_ops_runtime_state("public_status", status)
    set_ops_runtime_state("analysis_status", analysis)
    return payload


__all__ = ["build_analysis_payload", "build_ops_snapshot_payload"]
