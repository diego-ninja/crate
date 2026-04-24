"""Compatibility facade for persisted read-model helpers."""

from __future__ import annotations

from crate.db.domain_events import (
    append_domain_event,
    get_latest_domain_event_id,
    list_domain_events,
    mark_domain_events_processed,
)
from crate.db.ops_runtime import get_ops_runtime_state, set_ops_runtime_state
from crate.db.ui_snapshot_store import (
    get_or_build_ui_snapshot,
    get_ui_snapshot,
    mark_ui_snapshots_stale,
    upsert_ui_snapshot,
)


__all__ = [
    "append_domain_event",
    "get_latest_domain_event_id",
    "get_ops_runtime_state",
    "get_or_build_ui_snapshot",
    "get_ui_snapshot",
    "list_domain_events",
    "mark_domain_events_processed",
    "mark_ui_snapshots_stale",
    "set_ops_runtime_state",
    "upsert_ui_snapshot",
]
