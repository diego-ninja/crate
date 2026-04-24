"""Snapshot builders for admin health surfaces."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from crate.db.cache_runtime import _get_redis
from crate.db.health import get_issue_counts, get_open_issues
from crate.db.ui_snapshot_store import get_or_build_ui_snapshot

HEALTH_SNAPSHOT_SCOPE = "ops:health"
HEALTH_SNAPSHOT_MAX_AGE = 10
HEALTH_SNAPSHOT_STALE_MAX_AGE = 120
HEALTH_SURFACE_STREAM_CHANNEL = "crate:sse:admin:health"


def build_health_surface_payload(*, check_type: str | None = None, limit: int = 500) -> dict:
    issues = get_open_issues(check_type=check_type, limit=limit)
    counts = get_issue_counts()
    return {
        "issues": issues,
        "counts": counts,
        "total": len(issues),
        "filter": check_type or None,
    }


def get_health_surface_subject(*, check_type: str | None = None, limit: int = 500) -> str:
    safe_limit = min(max(int(limit or 500), 1), 1000)
    normalized_check = (check_type or "").strip() or "all"
    return f"surface:{normalized_check}:{safe_limit}"


def get_cached_health_surface(*, check_type: str | None = None, limit: int = 500, fresh: bool = False) -> dict:
    safe_limit = min(max(int(limit or 500), 1), 1000)
    normalized_check = (check_type or "").strip() or "all"
    return get_or_build_ui_snapshot(
        scope=HEALTH_SNAPSHOT_SCOPE,
        subject_key=f"surface:{normalized_check}:{safe_limit}",
        max_age_seconds=HEALTH_SNAPSHOT_MAX_AGE,
        stale_max_age_seconds=HEALTH_SNAPSHOT_STALE_MAX_AGE,
        fresh=fresh,
        allow_stale_on_error=True,
        build=lambda: build_health_surface_payload(
            check_type=None if normalized_check == "all" else normalized_check,
            limit=safe_limit,
        ),
    )


def publish_health_surface_signal(*, check_type: str | None = None, limit: int = 500) -> None:
    try:
        redis = _get_redis()
        if not redis:
            return
        payload = json.dumps(
            {
                "kind": "health",
                "subject_key": get_health_surface_subject(check_type=check_type, limit=limit),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
        redis.publish(HEALTH_SURFACE_STREAM_CHANNEL, payload)
    except Exception:
        return


__all__ = [
    "HEALTH_SNAPSHOT_SCOPE",
    "HEALTH_SNAPSHOT_MAX_AGE",
    "HEALTH_SNAPSHOT_STALE_MAX_AGE",
    "HEALTH_SURFACE_STREAM_CHANNEL",
    "build_health_surface_payload",
    "get_cached_health_surface",
    "get_health_surface_subject",
    "publish_health_surface_signal",
]
