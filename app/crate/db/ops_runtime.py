"""Operational runtime state helpers for the admin/read plane."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text

from crate.db.read_model_shared import coerce_datetime, coerce_json, utc_now
from crate.db.tx import optional_scope, read_scope


def get_ops_runtime_state(key: str, *, max_age_seconds: int | None = None) -> dict[str, Any] | None:
    with read_scope() as session:
        row = session.execute(
            text("SELECT key, payload_json, updated_at FROM ops_runtime_state WHERE key = :key"),
            {"key": key},
        ).mappings().first()
    if not row:
        return None
    record = dict(row)
    updated_at = coerce_datetime(record.get("updated_at"))
    if max_age_seconds is not None and updated_at is not None:
        if (utc_now() - updated_at).total_seconds() > max_age_seconds:
            return None
    payload = coerce_json(record.get("payload_json")) or {}
    if isinstance(payload, dict):
        payload["updated_at"] = record.get("updated_at")
    return payload


def set_ops_runtime_state(key: str, payload: dict[str, Any], *, session=None) -> None:
    now = utc_now().isoformat()
    with optional_scope(session) as managed:
        managed.execute(
            text(
                """
                INSERT INTO ops_runtime_state (key, payload_json, updated_at)
                VALUES (:key, CAST(:payload_json AS jsonb), :updated_at)
                ON CONFLICT (key) DO UPDATE SET
                    payload_json = EXCLUDED.payload_json,
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {
                "key": key,
                "payload_json": json.dumps(payload, default=str),
                "updated_at": now,
            },
        )


__all__ = ["get_ops_runtime_state", "set_ops_runtime_state"]
