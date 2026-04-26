"""Compatibility facade for admin ops snapshot builders."""

from __future__ import annotations

from crate.db.ops_snapshot_activity import (
    build_live_activity_payload,
    build_public_status_payload,
    build_recent_activity_payload,
    build_runtime_payload,
    build_upcoming_shows_payload,
    get_public_status_snapshot,
)
from crate.db.ops_snapshot_pipeline import (
    build_analysis_payload,
    build_ops_snapshot_payload,
)
from crate.db.ops_runtime_views import get_worker_live_state
from crate.db.ops_snapshot_stats import build_analytics_payload, build_stats_payload


__all__ = [
    "build_analysis_payload",
    "build_analytics_payload",
    "build_live_activity_payload",
    "build_ops_snapshot_payload",
    "build_public_status_payload",
    "build_recent_activity_payload",
    "build_runtime_payload",
    "build_stats_payload",
    "build_upcoming_shows_payload",
    "get_worker_live_state",
    "get_public_status_snapshot",
]
