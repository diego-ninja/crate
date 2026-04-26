"""Snapshot-backed read helpers for analytics surfaces."""

from __future__ import annotations

from crate.db.analytics_missing_surface import (
    empty_missing_report,
    get_cached_missing_report,
    get_missing_artist_by_id,
    list_local_albums_for_missing,
    mark_missing_reports_stale,
    missing_snapshot_subject_key,
    resolve_missing_artist,
    save_missing_report_snapshot,
)
from crate.db.analytics_quality_surface import (
    empty_quality_report,
    get_cached_quality_report,
    mark_quality_report_stale,
    save_quality_report_snapshot,
)
from crate.db.analytics_surface_invalidation import invalidate_analytics_surfaces
from crate.db.analytics_surface_shared import (
    MISSING_SNAPSHOT_SCOPE,
    QUALITY_SNAPSHOT_SCOPE,
    _decorate_snapshot,
    utc_now_iso,
)


__all__ = [
    "MISSING_SNAPSHOT_SCOPE",
    "QUALITY_SNAPSHOT_SCOPE",
    "_decorate_snapshot",
    "empty_missing_report",
    "empty_quality_report",
    "get_cached_missing_report",
    "get_cached_quality_report",
    "get_missing_artist_by_id",
    "invalidate_analytics_surfaces",
    "list_local_albums_for_missing",
    "mark_missing_reports_stale",
    "mark_quality_report_stale",
    "missing_snapshot_subject_key",
    "resolve_missing_artist",
    "save_missing_report_snapshot",
    "save_quality_report_snapshot",
    "utc_now_iso",
]
