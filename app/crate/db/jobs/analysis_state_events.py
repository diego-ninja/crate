from __future__ import annotations

from crate.db.domain_events import append_domain_event
from crate.db.ui_snapshot_store import mark_ui_snapshots_stale


def mark_ops_snapshot_dirty(session) -> None:
    mark_ui_snapshots_stale(scope="ops", subject_key="dashboard", session=session)


def append_pipeline_event(
    session,
    *,
    pipeline: str,
    track_id: int | None,
    state: str,
    error_message: str | None = None,
) -> None:
    event_type = "track.bliss.updated" if pipeline == "bliss" else "track.analysis.updated"
    append_domain_event(
        event_type,
        {
            "track_id": track_id,
            "pipeline": pipeline,
            "state": state,
            "error": error_message,
        },
        scope=f"pipeline:{pipeline}",
        subject_key=str(track_id) if track_id else pipeline,
        session=session,
    )


__all__ = [
    "append_pipeline_event",
    "mark_ops_snapshot_dirty",
]
