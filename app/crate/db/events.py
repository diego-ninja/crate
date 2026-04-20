import json
from datetime import datetime, timezone, timedelta

from sqlalchemy import text

from crate.db.tx import transaction_scope


def emit_task_event(task_id: str, event_type: str, data: dict | None = None):
    """Emit an event for a task. Events are stored in DB and streamed via SSE.

    Events with type "info", "warn", "error", or "item" are also
    written to worker_logs so they appear in the admin Logs page.
    """
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO task_events (task_id, event_type, data_json, created_at) "
                "VALUES (:task_id, :event_type, :data_json, :created_at)"
            ),
            {"task_id": task_id, "event_type": event_type,
             "data_json": json.dumps(data or {}, default=str), "created_at": now},
        )

    # Mirror significant events to worker_logs for the Logs page
    if event_type in ("info", "warn", "error", "item"):
        try:
            from crate.db.worker_logs import insert_log
            safe_data = data or {}
            message = safe_data.get("message") or safe_data.get("label") or event_type
            level = safe_data.get("level", event_type if event_type in ("warn", "error") else "info")
            insert_log(
                level=level,
                message=str(message),
                task_id=task_id,
                category=safe_data.get("category", "general"),
                metadata={k: v for k, v in safe_data.items()
                          if k not in ("level", "message", "category")} or None,
            )
        except Exception:
            pass


def get_task_events(task_id: str, after_id: int = 0, limit: int = 100) -> list[dict]:
    """Get events for a task after a given ID."""
    with transaction_scope() as session:
        rows = session.execute(
            text(
                "SELECT id, event_type, data_json, created_at FROM task_events "
                "WHERE task_id = :task_id AND id > :after_id ORDER BY id LIMIT :lim"
            ),
            {"task_id": task_id, "after_id": after_id, "lim": limit},
        ).mappings().all()
    results = []
    for r in rows:
        d = dict(r)
        data = d.pop("data_json", {})
        d["data"] = data if isinstance(data, dict) else json.loads(data or "{}")
        results.append(d)
    return results


def cleanup_task_events(task_id: str):
    """Remove all events for a completed task."""
    with transaction_scope() as session:
        session.execute(
            text("DELETE FROM task_events WHERE task_id = :task_id"),
            {"task_id": task_id},
        )


def cleanup_old_events(max_age_hours: int = 48):
    """Remove events older than max_age_hours."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=max_age_hours)).isoformat()
    with transaction_scope() as session:
        session.execute(
            text("DELETE FROM task_events WHERE created_at < :cutoff"),
            {"cutoff": cutoff},
        )


def cleanup_orphan_events():
    """Remove events whose task no longer exists."""
    with transaction_scope() as session:
        session.execute(text("""
            DELETE FROM task_events
            WHERE task_id NOT IN (SELECT id FROM tasks)
        """))


def cleanup_old_tasks(max_age_days: int = 7):
    """Remove completed/failed/cancelled tasks older than N days."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()
    with transaction_scope() as session:
        session.execute(text("""
            DELETE FROM task_events WHERE task_id IN (
                SELECT id FROM tasks
                WHERE status IN ('completed', 'failed', 'cancelled')
                AND created_at < :cutoff
            )
        """), {"cutoff": cutoff})
        session.execute(text("""
            DELETE FROM tasks
            WHERE status IN ('completed', 'failed', 'cancelled')
            AND created_at < :cutoff
        """), {"cutoff": cutoff})
