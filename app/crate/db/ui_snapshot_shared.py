"""Shared helpers for persistent UI snapshots."""

from __future__ import annotations

from typing import Any

from crate.db.read_model_shared import coerce_datetime, coerce_json, utc_now


def snapshot_age_ok(row: dict[str, Any], max_age_seconds: int | None) -> bool:
    stale_after = coerce_datetime(row.get("stale_after"))
    if stale_after is not None and stale_after <= utc_now():
        return False
    if max_age_seconds is None:
        return True
    built_at = coerce_datetime(row.get("built_at"))
    if built_at is None:
        return False
    return (utc_now() - built_at).total_seconds() <= max_age_seconds


def decorate_snapshot(row: dict[str, Any], *, stale: bool = False) -> dict[str, Any]:
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


__all__ = ["decorate_snapshot", "snapshot_age_ok"]
