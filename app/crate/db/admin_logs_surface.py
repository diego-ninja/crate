"""Snapshot builders for admin log surfaces."""

from __future__ import annotations

from crate.db.ui_snapshot_store import get_or_build_ui_snapshot
from crate.db.worker_logs import list_known_workers, query_logs

LOGS_SNAPSHOT_SCOPE = "ops:logs"
LOGS_SNAPSHOT_MAX_AGE = 15
LOGS_SNAPSHOT_STALE_MAX_AGE = 60
LOGS_SURFACE_STREAM_CHANNEL = "crate:sse:admin:logs"


def build_logs_surface_payload(limit: int = 100) -> dict:
    safe_limit = min(max(int(limit or 100), 1), 200)
    return {
        "logs": query_logs(limit=safe_limit),
        "workers": list_known_workers(),
    }


def get_cached_logs_surface(*, limit: int = 100, fresh: bool = False) -> dict:
    safe_limit = min(max(int(limit or 100), 1), 200)
    return get_or_build_ui_snapshot(
        scope=LOGS_SNAPSHOT_SCOPE,
        subject_key=f"surface:{safe_limit}",
        max_age_seconds=LOGS_SNAPSHOT_MAX_AGE,
        stale_max_age_seconds=LOGS_SNAPSHOT_STALE_MAX_AGE,
        fresh=fresh,
        allow_stale_on_error=True,
        build=lambda: build_logs_surface_payload(safe_limit),
    )


__all__ = [
    "LOGS_SNAPSHOT_SCOPE",
    "LOGS_SNAPSHOT_MAX_AGE",
    "LOGS_SNAPSHOT_STALE_MAX_AGE",
    "LOGS_SURFACE_STREAM_CHANNEL",
    "build_logs_surface_payload",
    "get_cached_logs_surface",
]
