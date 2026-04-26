"""Build/fallback helpers for persistent UI snapshots."""

from __future__ import annotations

import time
from typing import Callable

from crate.db.domain_events import get_latest_domain_event_id
from crate.db.ui_snapshot_reads import get_ui_snapshot
from crate.db.ui_snapshot_shared import decorate_snapshot
from crate.db.ui_snapshot_writes import upsert_ui_snapshot


def get_or_build_ui_snapshot(
    *,
    scope: str,
    subject_key: str = "global",
    max_age_seconds: int,
    stale_max_age_seconds: int | None = None,
    fresh: bool = False,
    allow_stale_on_error: bool = False,
    build: Callable[[], dict],
) -> dict:
    if not fresh:
        cached = get_ui_snapshot(scope, subject_key, max_age_seconds=max_age_seconds)
        if cached:
            return decorate_snapshot(cached)

    stale = None
    if allow_stale_on_error and stale_max_age_seconds is not None and not fresh:
        stale = get_ui_snapshot(scope, subject_key, max_age_seconds=stale_max_age_seconds)

    started = time.monotonic()
    source_seq = get_latest_domain_event_id()
    try:
        payload = build()
    except Exception:
        if stale:
            return decorate_snapshot(stale, stale=True)
        raise

    saved = upsert_ui_snapshot(
        scope,
        subject_key,
        payload,
        generation_ms=int((time.monotonic() - started) * 1000),
        stale_after_seconds=max_age_seconds,
        source_seq=source_seq,
    )
    return decorate_snapshot(saved)


__all__ = ["get_or_build_ui_snapshot"]
