"""Shared helpers for persistent import queue read models."""

from __future__ import annotations

import json
from typing import Any


def normalize_import_item(item: dict[str, Any]) -> dict[str, Any]:
    source = str(item.get("source") or "filesystem")
    path = str(item.get("source_path") or item.get("path") or "")
    if not path:
        raise ValueError("Import queue item requires source_path/path")
    return {
        "source": source,
        "path": path,
        "artist": item.get("artist"),
        "album": item.get("album"),
        "track_count": int(item.get("track_count") or 0),
        "formats": list(item.get("formats") or []),
        "total_size_mb": item.get("total_size_mb") or 0,
        "dest_path": item.get("dest_path") or "",
        "dest_exists": bool(item.get("dest_exists")),
        "status": str(item.get("status") or "pending"),
    }


def payload_for_row(item: dict[str, Any], *, status: str) -> dict[str, Any]:
    return {
        "source": item["source"],
        "source_path": item["path"],
        "artist": item.get("artist"),
        "album": item.get("album"),
        "track_count": item.get("track_count") or 0,
        "formats": list(item.get("formats") or []),
        "total_size_mb": item.get("total_size_mb") or 0,
        "dest_path": item.get("dest_path") or "",
        "dest_exists": bool(item.get("dest_exists")),
        "status": status,
    }


def row_to_import_item(row: dict[str, Any]) -> dict[str, Any]:
    payload = coerce_json(row.get("payload_json")) or {}
    payload.update(
        {
            "source": row.get("source") or payload.get("source") or "filesystem",
            "source_path": row.get("path") or payload.get("source_path") or "",
            "artist": row.get("artist") or payload.get("artist") or "",
            "album": row.get("album") or payload.get("album") or "",
            "status": row.get("status") or payload.get("status") or "pending",
        }
    )
    payload.setdefault("track_count", 0)
    payload.setdefault("formats", [])
    payload.setdefault("total_size_mb", 0)
    payload.setdefault("dest_path", "")
    payload.setdefault("dest_exists", False)
    return payload


def coerce_import_status(existing_status: str | None, discovered_status: str) -> str:
    if existing_status in {"imported", "merged"} and discovered_status == "pending":
        return existing_status
    return discovered_status or existing_status or "pending"


def coerce_json(value: Any) -> dict[str, Any] | list[Any] | None:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return None


__all__ = [
    "coerce_import_status",
    "coerce_json",
    "normalize_import_item",
    "payload_for_row",
    "row_to_import_item",
]
