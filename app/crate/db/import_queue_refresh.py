"""Refresh helpers for persistent import queue read models."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text

from crate.db.domain_events import append_domain_event
from crate.db.import_queue_shared import coerce_import_status, normalize_import_item, payload_for_row
from crate.db.ops_runtime import set_ops_runtime_state
from crate.db.tx import transaction_scope
from crate.db.ui_snapshot_store import mark_ui_snapshots_stale


def refresh_import_queue_items(
    items: list[dict[str, Any]],
    *,
    scanned_sources: list[str] | None = None,
) -> dict[str, int]:
    normalized = [normalize_import_item(item) for item in items]
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
            status = coerce_import_status(existing_status.get(key), item["status"])
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
                    "payload_json": json.dumps(payload_for_row(item, status=status), default=str),
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


__all__ = ["refresh_import_queue_items"]
