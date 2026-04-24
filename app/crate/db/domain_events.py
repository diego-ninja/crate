"""Persistent domain-event helpers for snapshot invalidation and projection."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text

from crate.db.read_model_shared import coerce_json, utc_now
from crate.db.tx import optional_scope, read_scope


def append_domain_event(
    event_type: str,
    payload: dict[str, Any] | None = None,
    *,
    scope: str | None = None,
    subject_key: str | None = None,
    session=None,
) -> int:
    with optional_scope(session) as managed:
        row = managed.execute(
            text(
                """
                INSERT INTO domain_events (event_type, scope, subject_key, payload_json, created_at)
                VALUES (:event_type, :scope, :subject_key, CAST(:payload_json AS jsonb), :created_at)
                RETURNING id
                """
            ),
            {
                "event_type": event_type,
                "scope": scope,
                "subject_key": subject_key,
                "payload_json": json.dumps(payload or {}, default=str),
                "created_at": utc_now().isoformat(),
            },
        ).mappings().first()
        return int(row["id"])


def get_latest_domain_event_id(*, scope: str | None = None, subject_key: str | None = None) -> int:
    query = "SELECT COALESCE(MAX(id), 0) AS latest_id FROM domain_events"
    params: dict[str, Any] = {}
    clauses: list[str] = []
    if scope is not None:
        clauses.append("scope = :scope")
        params["scope"] = scope
    if subject_key is not None:
        clauses.append("subject_key = :subject_key")
        params["subject_key"] = subject_key
    if clauses:
        query += " WHERE " + " AND ".join(clauses)

    with read_scope() as session:
        row = session.execute(text(query), params).mappings().first()
    return int((row or {}).get("latest_id") or 0)


def list_domain_events(*, limit: int = 100, unprocessed_only: bool = True) -> list[dict[str, Any]]:
    query = (
        "SELECT id, event_type, scope, subject_key, payload_json, created_at, processed_at "
        "FROM domain_events "
    )
    params: dict[str, Any] = {"limit": max(limit, 1)}
    if unprocessed_only:
        query += "WHERE processed_at IS NULL "
    query += "ORDER BY id ASC LIMIT :limit"

    with read_scope() as session:
        rows = session.execute(text(query), params).mappings().all()

    result = []
    for row in rows:
        record = dict(row)
        record["payload_json"] = coerce_json(record.get("payload_json"))
        result.append(record)
    return result


def mark_domain_events_processed(event_ids: list[int], *, session=None) -> None:
    cleaned = [int(event_id) for event_id in event_ids if event_id]
    if not cleaned:
        return
    with optional_scope(session) as managed:
        managed.execute(
            text(
                """
                UPDATE domain_events
                SET processed_at = :processed_at
                WHERE id = ANY(:event_ids)
                """
            ),
            {"processed_at": utc_now().isoformat(), "event_ids": cleaned},
        )


__all__ = [
    "append_domain_event",
    "get_latest_domain_event_id",
    "list_domain_events",
    "mark_domain_events_processed",
]
