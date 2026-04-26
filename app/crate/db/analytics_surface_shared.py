"""Shared helpers for analytics snapshot-backed surfaces."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any


QUALITY_SNAPSHOT_SCOPE = "analytics:quality"
MISSING_SNAPSHOT_SCOPE = "analytics:missing"


def _decorate_snapshot(row: dict[str, Any], *, stale: bool = False) -> dict[str, Any]:
    payload = row.get("payload_json") or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            payload = {}
    if not isinstance(payload, dict):
        payload = {"value": payload}
    data = dict(payload)
    data["snapshot"] = {
        "scope": row.get("scope"),
        "subject_key": row.get("subject_key"),
        "version": int(row.get("version") or 1),
        "built_at": row.get("built_at"),
        "source_seq": int(row.get("source_seq") or 0),
        "stale_after": row.get("stale_after"),
        "stale": stale,
        "generation_ms": int(row.get("generation_ms") or 0),
    }
    return data


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


__all__ = [
    "MISSING_SNAPSHOT_SCOPE",
    "QUALITY_SNAPSHOT_SCOPE",
    "_decorate_snapshot",
    "utc_now_iso",
]
