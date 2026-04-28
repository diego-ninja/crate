"""Write helpers for persistent UI snapshots."""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any, Callable

from sqlalchemy import text

from crate.db.read_model_shared import utc_now
from crate.db.snapshot_events import publish_snapshot_update
from crate.db.tx import optional_scope


def upsert_ui_snapshot(
    scope: str,
    subject_key: str,
    payload: dict[str, Any],
    *,
    generation_ms: int = 0,
    stale_after_seconds: int | None = None,
    source_seq: int | None = None,
    publish_snapshot: Callable[[str, str, int], None] = publish_snapshot_update,
    session=None,
) -> dict[str, Any]:
    now = utc_now()
    stale_after = now + timedelta(seconds=stale_after_seconds) if stale_after_seconds else None
    record: dict[str, Any] | None = None
    with optional_scope(session) as managed:
        row = managed.execute(
            text(
                """
                INSERT INTO ui_snapshots (
                    scope,
                    subject_key,
                    version,
                    payload_json,
                    built_at,
                    source_seq,
                    generation_ms,
                    stale_after
                )
                VALUES (
                    :scope,
                    :subject_key,
                    1,
                    CAST(:payload_json AS jsonb),
                    :built_at,
                    :source_seq,
                    :generation_ms,
                    :stale_after
                )
                ON CONFLICT (scope, subject_key) DO UPDATE SET
                    version = ui_snapshots.version + 1,
                    payload_json = EXCLUDED.payload_json,
                    built_at = EXCLUDED.built_at,
                    source_seq = COALESCE(EXCLUDED.source_seq, ui_snapshots.source_seq),
                    generation_ms = EXCLUDED.generation_ms,
                    stale_after = EXCLUDED.stale_after
                RETURNING scope, subject_key, version, payload_json, built_at, source_seq, generation_ms, stale_after
                """
            ),
            {
                "scope": scope,
                "subject_key": subject_key,
                "payload_json": json.dumps(payload, default=str),
                "built_at": now.isoformat(),
                "source_seq": source_seq,
                "generation_ms": int(generation_ms),
                "stale_after": stale_after.isoformat() if stale_after else None,
            },
        ).mappings().first()
        record = dict(row)
    if record is None:
        raise RuntimeError("Snapshot upsert did not return a row")
    if session is None:
        publish_snapshot(scope, subject_key, int(record.get("version") or 1))
    return record


def mark_ui_snapshots_stale(
    *,
    scope: str | None = None,
    scope_prefix: str | None = None,
    subject_key: str | None = None,
    session=None,
) -> int:
    if scope is None and scope_prefix is None:
        raise ValueError("scope or scope_prefix is required")

    clauses: list[str] = []
    params: dict[str, Any] = {"stale_after": (utc_now() - timedelta(seconds=1)).isoformat()}
    if scope is not None:
        clauses.append("scope = :scope")
        params["scope"] = scope
    if scope_prefix is not None:
        clauses.append("scope LIKE :scope_prefix")
        params["scope_prefix"] = f"{scope_prefix}%"
    if subject_key is not None:
        clauses.append("subject_key = :subject_key")
        params["subject_key"] = subject_key

    query = (
        "UPDATE ui_snapshots "
        "SET stale_after = :stale_after "
        f"WHERE {' AND '.join(clauses)}"
    )

    with optional_scope(session) as managed:
        result = managed.execute(text(query), params)
        return int(result.rowcount or 0)


__all__ = ["mark_ui_snapshots_stale", "upsert_ui_snapshot"]
