"""Persistent read models for staged library imports."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text

from crate.db.domain_events import append_domain_event
from crate.db.ops_runtime import get_ops_runtime_state, set_ops_runtime_state
from crate.db.tx import read_scope, transaction_scope
from crate.db.ui_snapshot_store import mark_ui_snapshots_stale


def refresh_import_queue_items(
    items: list[dict[str, Any]],
    *,
    scanned_sources: list[str] | None = None,
) -> dict[str, int]:
    normalized = [_normalize_import_item(item) for item in items]
    sources = scanned_sources or sorted({item["source"] for item in normalized})

    with transaction_scope() as session:
        existing_rows: list[dict[str, Any]] = []
        if sources:
            existing_rows = [
                dict(row)
                for row in session.execute(
                    text(
                        """
                        SELECT source, path, status
                        FROM import_queue_items
                        WHERE source = ANY(:sources)
                        """
                    ),
                    {"sources": sources},
                ).mappings().all()
            ]
        existing_status = {(row["source"], row["path"]): row["status"] for row in existing_rows}
        seen: set[tuple[str, str]] = set()

        upserted = 0
        for item in normalized:
            key = (item["source"], item["path"])
            seen.add(key)
            status = _coerce_import_status(existing_status.get(key), item["status"])
            session.execute(
                text(
                    """
                    INSERT INTO import_queue_items (
                        source,
                        path,
                        artist,
                        album,
                        status,
                        payload_json,
                        discovered_at,
                        updated_at
                    )
                    VALUES (
                        :source,
                        :path,
                        :artist,
                        :album,
                        :status,
                        CAST(:payload_json AS jsonb),
                        NOW(),
                        NOW()
                    )
                    ON CONFLICT (source, path) DO UPDATE SET
                        artist = EXCLUDED.artist,
                        album = EXCLUDED.album,
                        status = EXCLUDED.status,
                        payload_json = EXCLUDED.payload_json,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "source": item["source"],
                    "path": item["path"],
                    "artist": item.get("artist"),
                    "album": item.get("album"),
                    "status": status,
                    "payload_json": json.dumps(_payload_for_row(item, status=status), default=str),
                },
            )
            upserted += 1

        removed = 0
        stale_keys = [key for key in existing_status if key not in seen]
        for source, path in stale_keys:
            result = session.execute(
                text("DELETE FROM import_queue_items WHERE source = :source AND path = :path"),
                {"source": source, "path": path},
            )
            removed += int(result.rowcount or 0)

        pending_count = int(
            session.execute(
                text("SELECT COUNT(*) AS cnt FROM import_queue_items WHERE status = 'pending'")
            ).scalar()
            or 0
        )
        set_ops_runtime_state("imports_pending", {"count": pending_count}, session=session)
        if upserted or removed:
            mark_ui_snapshots_stale(scope="ops", subject_key="dashboard", session=session)
            append_domain_event(
                "library.import_queue.changed",
                {
                    "pending_count": pending_count,
                    "upserted": upserted,
                    "removed": removed,
                },
                scope="ops",
                subject_key="import_queue",
                session=session,
            )

    return {"pending": pending_count, "upserted": upserted, "removed": removed}


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

    return [_row_to_import_item(dict(row)) for row in rows]


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


def mark_import_queue_item_imported(
    source_path: str,
    *,
    result: dict[str, Any],
    source: str | None = None,
) -> bool:
    return _update_import_queue_item_status(
        source_path,
        status=result.get("status") or "imported",
        payload_patch=result,
        source=source,
    )


def remove_import_queue_item(source_path: str, *, source: str | None = None) -> bool:
    with transaction_scope() as session:
        if source:
            result = session.execute(
                text("DELETE FROM import_queue_items WHERE source = :source AND path = :path"),
                {"source": source, "path": source_path},
            )
        else:
            result = session.execute(
                text("DELETE FROM import_queue_items WHERE path = :path"),
                {"path": source_path},
            )
        removed = int(result.rowcount or 0)
        pending_count = int(
            session.execute(
                text("SELECT COUNT(*) AS cnt FROM import_queue_items WHERE status = 'pending'")
            ).scalar()
            or 0
        )
        set_ops_runtime_state("imports_pending", {"count": pending_count}, session=session)
        if removed:
            mark_ui_snapshots_stale(scope="ops", subject_key="dashboard", session=session)
            append_domain_event(
                "library.import_queue.changed",
                {"pending_count": pending_count, "removed": removed},
                scope="ops",
                subject_key="import_queue",
                session=session,
            )
        return removed > 0


def _update_import_queue_item_status(
    source_path: str,
    *,
    status: str,
    payload_patch: dict[str, Any] | None = None,
    source: str | None = None,
) -> bool:
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                SELECT source, path, payload_json
                FROM import_queue_items
                WHERE path = :path
                  AND (:source IS NULL OR source = :source)
                ORDER BY updated_at DESC
                LIMIT 1
                """
            ),
            {"path": source_path, "source": source},
        ).mappings().first()
        if not row:
            return False

        payload = _coerce_json(row.get("payload_json")) or {}
        if payload_patch:
            payload.update(payload_patch)
        payload["status"] = status

        session.execute(
            text(
                """
                UPDATE import_queue_items
                SET status = :status,
                    payload_json = CAST(:payload_json AS jsonb),
                    updated_at = NOW()
                WHERE source = :source AND path = :path
                """
            ),
            {
                "status": status,
                "payload_json": json.dumps(payload, default=str),
                "source": row["source"],
                "path": row["path"],
            },
        )
        pending_count = int(
            session.execute(
                text("SELECT COUNT(*) AS cnt FROM import_queue_items WHERE status = 'pending'")
            ).scalar()
            or 0
        )
        set_ops_runtime_state("imports_pending", {"count": pending_count}, session=session)
        mark_ui_snapshots_stale(scope="ops", subject_key="dashboard", session=session)
        append_domain_event(
            "library.import_queue.changed",
            {
                "pending_count": pending_count,
                "path": row["path"],
                "status": status,
            },
            scope="ops",
            subject_key="import_queue",
            session=session,
        )
        return True


def _normalize_import_item(item: dict[str, Any]) -> dict[str, Any]:
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


def _payload_for_row(item: dict[str, Any], *, status: str) -> dict[str, Any]:
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


def _row_to_import_item(row: dict[str, Any]) -> dict[str, Any]:
    payload = _coerce_json(row.get("payload_json")) or {}
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


def _coerce_import_status(existing_status: str | None, discovered_status: str) -> str:
    if existing_status in {"imported", "merged"} and discovered_status == "pending":
        return existing_status
    return discovered_status or existing_status or "pending"


def _coerce_json(value: Any) -> dict[str, Any] | list[Any] | None:
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
