"""Query helpers for persistent import queue read models."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from crate.db.import_queue_shared import row_to_import_item
from crate.db.ops_runtime import get_ops_runtime_state
from crate.db.tx import read_scope


def list_import_queue_items(*, status: str | None = "pending", limit: int = 500) -> list[dict[str, Any]]:
    query = (
        "SELECT source, path, artist, album, status, payload_json, discovered_at, updated_at "
        "FROM import_queue_items "
    )
    params: dict[str, Any] = {"limit": max(1, limit)}
    if status is not None:
        query += "WHERE status = :status "
        params["status"] = status
    query += "ORDER BY updated_at DESC, discovered_at DESC LIMIT :limit"

    with read_scope() as session:
        rows = session.execute(text(query), params).mappings().all()

    return [row_to_import_item(dict(row)) for row in rows]


def count_import_queue_items(*, status: str = "pending") -> int:
    cached = get_ops_runtime_state("imports_pending", max_age_seconds=180)
    if status == "pending" and cached:
        try:
            return int(cached.get("count") or 0)
        except (TypeError, ValueError, AttributeError):
            pass

    with read_scope() as session:
        row = session.execute(
            text("SELECT COUNT(*) AS cnt FROM import_queue_items WHERE status = :status"),
            {"status": status},
        ).mappings().first()
    return int((row or {}).get("cnt") or 0)


__all__ = ["count_import_queue_items", "list_import_queue_items"]
