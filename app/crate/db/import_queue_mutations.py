"""Mutation helpers for persistent import queue read models."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text

from crate.db.domain_events import append_domain_event
from crate.db.import_queue_shared import coerce_json
from crate.db.ops_runtime import set_ops_runtime_state
from crate.db.tx import transaction_scope
from crate.db.ui_snapshot_store import mark_ui_snapshots_stale


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

        payload = coerce_json(row.get("payload_json")) or {}
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


__all__ = ["mark_import_queue_item_imported", "remove_import_queue_item"]
