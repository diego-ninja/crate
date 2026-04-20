"""Structured worker log storage and query.

Workers emit logs via wlog.info/warn/error which persist to the
worker_logs table (7-day retention, auto-cleaned by service loop).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

from crate.db.tx import transaction_scope
from sqlalchemy import text

_log = logging.getLogger(__name__)


def _worker_id() -> str:
    return os.environ.get("CRATE_WORKER_ID", f"worker-{os.getpid()}")


def insert_log(
    level: str,
    message: str,
    *,
    worker_id: str | None = None,
    task_id: str | None = None,
    category: str = "general",
    metadata: dict | None = None,
):
    try:
        with transaction_scope() as session:
            session.execute(
                text("""
                    INSERT INTO worker_logs (worker_id, task_id, level, category, message, metadata_json, created_at)
                    VALUES (:worker_id, :task_id, :level, :category, :message, :metadata, now())
                """),
                {
                    "worker_id": worker_id or _worker_id(),
                    "task_id": task_id,
                    "level": level,
                    "category": category,
                    "message": message,
                    "metadata": json.dumps(metadata) if metadata else None,
                },
            )
    except Exception:
        _log.debug("Failed to insert worker log", exc_info=True)


def query_logs(
    *,
    worker_id: str | None = None,
    task_id: str | None = None,
    level: str | None = None,
    category: str | None = None,
    since: str | None = None,
    limit: int = 100,
) -> list[dict]:
    query = "SELECT * FROM worker_logs WHERE 1=1"
    params: dict = {"limit": limit}

    if worker_id:
        query += " AND worker_id = :worker_id"
        params["worker_id"] = worker_id
    if task_id:
        query += " AND task_id = :task_id"
        params["task_id"] = task_id
    if level:
        query += " AND level = :level"
        params["level"] = level
    if category:
        query += " AND category = :category"
        params["category"] = category
    if since:
        query += " AND created_at >= :since"
        params["since"] = since

    query += " ORDER BY created_at DESC LIMIT :limit"

    with transaction_scope() as session:
        rows = session.execute(text(query), params).mappings().all()
    return [_row_to_log(row) for row in rows]


def list_known_workers() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
                SELECT worker_id,
                       MAX(created_at) AS last_seen,
                       COUNT(*)::INTEGER AS log_count
                FROM worker_logs
                WHERE created_at > now() - interval '24 hours'
                GROUP BY worker_id
                ORDER BY last_seen DESC
            """)
        ).mappings().all()
    return [dict(row) for row in rows]


def cleanup_old_logs(max_age_days: int = 7):
    try:
        with transaction_scope() as session:
            result = session.execute(
                text("DELETE FROM worker_logs WHERE created_at < now() - (:days * interval '1 day')"),
                {"days": max_age_days},
            )
            deleted = result.rowcount
        if deleted:
            _log.debug("Cleaned up %d old worker log entries", deleted)
    except Exception:
        _log.debug("Worker log cleanup failed", exc_info=True)


def _row_to_log(row) -> dict:
    d = dict(row)
    meta_raw = d.pop("metadata_json", None)
    d["metadata"] = meta_raw if isinstance(meta_raw, dict) else (json.loads(meta_raw) if meta_raw else None)
    if hasattr(d.get("created_at"), "isoformat"):
        d["created_at"] = d["created_at"].isoformat()
    return d


# ── Convenience interface ────────────────────────────────────────

class _WorkerLogger:
    """Facade that emits structured logs to worker_logs table.

    Usage:
        from crate.db.worker_logs import wlog
        wlog.info("Fetched Last.fm data", task_id=tid, category="enrichment",
                  meta={"artist": "Birds In Row"})
    """

    def info(self, message: str, *, task_id: str | None = None,
             category: str = "general", meta: dict | None = None):
        insert_log("info", message, task_id=task_id, category=category, metadata=meta)

    def warn(self, message: str, *, task_id: str | None = None,
             category: str = "general", meta: dict | None = None):
        insert_log("warn", message, task_id=task_id, category=category, metadata=meta)

    def error(self, message: str, *, task_id: str | None = None,
              category: str = "general", meta: dict | None = None):
        insert_log("error", message, task_id=task_id, category=category, metadata=meta)


wlog = _WorkerLogger()
