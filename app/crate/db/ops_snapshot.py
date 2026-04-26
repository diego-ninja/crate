"""Snapshot builders for admin operational surfaces."""

from __future__ import annotations

from typing import Any

from crate.db.ops_snapshot_builders import (
    build_ops_snapshot_payload,
    get_public_status_snapshot as _get_public_status_snapshot,
)
from crate.db.ui_snapshot_store import get_or_build_ui_snapshot

_OPS_SNAPSHOT_SCOPE = "ops"
_OPS_SNAPSHOT_SUBJECT = "dashboard"
_OPS_SNAPSHOT_MAX_AGE = 15
_OPS_SNAPSHOT_STALE_MAX_AGE = 300


def get_cached_ops_snapshot(*, fresh: bool = False) -> dict[str, Any]:
    return get_or_build_ui_snapshot(
        scope=_OPS_SNAPSHOT_SCOPE,
        subject_key=_OPS_SNAPSHOT_SUBJECT,
        max_age_seconds=_OPS_SNAPSHOT_MAX_AGE,
        stale_max_age_seconds=_OPS_SNAPSHOT_STALE_MAX_AGE,
        fresh=fresh,
        allow_stale_on_error=True,
        build=build_ops_snapshot_payload,
    )


def get_public_status_snapshot() -> dict[str, Any]:
    cached = _get_public_status_snapshot()
    if cached:
        return cached
    return get_cached_ops_snapshot().get("status", {})


__all__ = [
    "build_ops_snapshot_payload",
    "get_cached_ops_snapshot",
    "get_public_status_snapshot",
]
