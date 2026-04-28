from __future__ import annotations

from crate.db.analytics_missing_surface import mark_missing_reports_stale
from crate.db.analytics_quality_surface import mark_quality_report_stale
from crate.db.tx import optional_scope


def invalidate_analytics_surfaces(*, session=None) -> None:
    with optional_scope(session) as managed:
        mark_quality_report_stale(session=managed)
        mark_missing_reports_stale(session=managed)


__all__ = ["invalidate_analytics_surfaces"]
