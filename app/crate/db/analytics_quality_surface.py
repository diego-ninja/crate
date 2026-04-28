from __future__ import annotations

from typing import Any

from crate.db.analytics_surface_shared import QUALITY_SNAPSHOT_SCOPE, _decorate_snapshot
from crate.db.ui_snapshot_store import get_ui_snapshot, mark_ui_snapshots_stale, upsert_ui_snapshot


def empty_quality_report(*, computing: bool = False, task_id: str | None = None) -> dict[str, Any]:
    return {
        "ready": False,
        "computing": computing,
        "task_id": task_id,
        "corrupt_count": 0,
        "low_bitrate_count": 0,
        "lossy_with_lossless_count": 0,
        "mixed_format_count": 0,
        "corrupt": [],
        "low_bitrate": [],
        "lossy_with_lossless": [],
        "mixed_format_albums": [],
    }


def get_cached_quality_report(*, max_age_seconds: int | None = None) -> dict[str, Any] | None:
    row = get_ui_snapshot(
        QUALITY_SNAPSHOT_SCOPE,
        "global",
        max_age_seconds=max_age_seconds,
    )
    return _decorate_snapshot(row) if row else None


def save_quality_report_snapshot(
    payload: dict[str, Any],
    *,
    generation_ms: int = 0,
    session=None,
) -> dict[str, Any]:
    saved = upsert_ui_snapshot(
        QUALITY_SNAPSHOT_SCOPE,
        "global",
        dict(payload),
        generation_ms=generation_ms,
        stale_after_seconds=86400,
        session=session,
    )
    return _decorate_snapshot(saved)


def mark_quality_report_stale(*, session=None) -> int:
    return mark_ui_snapshots_stale(
        scope=QUALITY_SNAPSHOT_SCOPE,
        subject_key="global",
        session=session,
    )


__all__ = [
    "empty_quality_report",
    "get_cached_quality_report",
    "mark_quality_report_stale",
    "save_quality_report_snapshot",
]
