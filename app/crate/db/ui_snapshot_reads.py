"""Read helpers for persistent UI snapshots."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope
from crate.db.ui_snapshot_shared import snapshot_age_ok


def get_ui_snapshot(
    scope: str,
    subject_key: str = "global",
    *,
    max_age_seconds: int | None = None,
) -> dict[str, Any] | None:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT scope, subject_key, version, payload_json, built_at, source_seq, generation_ms, stale_after
                FROM ui_snapshots
                WHERE scope = :scope AND subject_key = :subject_key
                """
            ),
            {"scope": scope, "subject_key": subject_key},
        ).mappings().first()
    if not row:
        return None
    record = dict(row)
    if not snapshot_age_ok(record, max_age_seconds):
        return None
    return record


__all__ = ["get_ui_snapshot"]
