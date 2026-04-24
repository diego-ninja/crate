"""Persistent UI snapshot helpers backed by PostgreSQL read models."""

from __future__ import annotations

import json
import time
from datetime import timedelta
from typing import Any, Callable

from sqlalchemy import text

from crate.db.domain_events import append_domain_event, get_latest_domain_event_id
from crate.db.read_model_shared import coerce_datetime, coerce_json, utc_now
from crate.db.snapshot_events import publish_snapshot_update
from crate.db.tx import optional_scope, read_scope


def _snapshot_age_ok(row: dict[str, Any], max_age_seconds: int | None) -> bool:
    stale_after = coerce_datetime(row.get("stale_after"))
    if stale_after is not None and stale_after <= utc_now():
        return False
    if max_age_seconds is None:
        return True
    built_at = coerce_datetime(row.get("built_at"))
    if built_at is None:
        return False
    return (utc_now() - built_at).total_seconds() <= max_age_seconds


def _decorate_snapshot(row: dict[str, Any], *, stale: bool = False) -> dict[str, Any]:
    payload = coerce_json(row.get("payload_json")) or {}
    if not isinstance(payload, dict):
        payload = {"value": payload}
    payload = dict(payload)
    payload["snapshot"] = {
        "scope": row.get("scope"),
        "subject_key": row.get("subject_key"),
        "version": int(row.get("version") or 1),
        "built_at": row.get("built_at"),
        "source_seq": int(row.get("source_seq") or 0),
        "stale_after": row.get("stale_after"),
        "stale": stale,
        "generation_ms": int(row.get("generation_ms") or 0),
    }
    return payload


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
    if not _snapshot_age_ok(record, max_age_seconds):
        return None
    return record


def upsert_ui_snapshot(
    scope: str,
    subject_key: str,
    payload: dict[str, Any],
    *,
    generation_ms: int = 0,
    stale_after_seconds: int | None = None,
    source_seq: int | None = None,
    emit_event: bool = True,
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
        if emit_event:
            append_domain_event(
                "ui.snapshot.updated",
                {
                    "scope": scope,
                    "subject_key": subject_key,
                    "version": int(record.get("version") or 1),
                },
                scope=scope,
                subject_key=subject_key,
                session=managed,
            )
    if record is None:
        raise RuntimeError("Snapshot upsert did not return a row")
    if session is None:
        publish_snapshot_update(scope, subject_key, int(record.get("version") or 1))
    return record


def get_or_build_ui_snapshot(
    *,
    scope: str,
    subject_key: str = "global",
    max_age_seconds: int,
    stale_max_age_seconds: int | None = None,
    fresh: bool = False,
    allow_stale_on_error: bool = False,
    build: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    if not fresh:
        cached = get_ui_snapshot(scope, subject_key, max_age_seconds=max_age_seconds)
        if cached:
            return _decorate_snapshot(cached)

    stale = None
    if allow_stale_on_error and stale_max_age_seconds is not None and not fresh:
        stale = get_ui_snapshot(scope, subject_key, max_age_seconds=stale_max_age_seconds)

    started = time.monotonic()
    source_seq = get_latest_domain_event_id()
    try:
        payload = build()
    except Exception:
        if stale:
            return _decorate_snapshot(stale, stale=True)
        raise

    saved = upsert_ui_snapshot(
        scope,
        subject_key,
        payload,
        generation_ms=int((time.monotonic() - started) * 1000),
        stale_after_seconds=max_age_seconds,
        source_seq=source_seq,
    )
    return _decorate_snapshot(saved)


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


__all__ = [
    "get_or_build_ui_snapshot",
    "get_ui_snapshot",
    "mark_ui_snapshots_stale",
    "upsert_ui_snapshot",
]
