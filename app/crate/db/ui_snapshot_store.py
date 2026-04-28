"""Persistent UI snapshot helpers backed by PostgreSQL read models."""

from __future__ import annotations

from crate.db.snapshot_events import publish_snapshot_update
from crate.db.ui_snapshot_building import get_or_build_ui_snapshot
from crate.db.ui_snapshot_reads import get_ui_snapshot
from crate.db.ui_snapshot_writes import (
    mark_ui_snapshots_stale,
    upsert_ui_snapshot as _upsert_ui_snapshot,
)


def upsert_ui_snapshot(*args, **kwargs):
    return _upsert_ui_snapshot(
        *args,
        publish_snapshot=publish_snapshot_update,
        **kwargs,
    )


__all__ = [
    "get_or_build_ui_snapshot",
    "get_ui_snapshot",
    "mark_ui_snapshots_stale",
    "publish_snapshot_update",
    "upsert_ui_snapshot",
]
