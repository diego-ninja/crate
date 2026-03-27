import json
from datetime import datetime, timezone, timedelta
from crate.db.core import get_db_ctx


def emit_task_event(task_id: str, event_type: str, data: dict | None = None):
    """Emit an event for a task. Events are stored in DB and streamed via SSE."""
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO task_events (task_id, event_type, data_json, created_at) "
            "VALUES (%s, %s, %s, %s)",
            (task_id, event_type, json.dumps(data or {}), now),
        )


def get_task_events(task_id: str, after_id: int = 0, limit: int = 100) -> list[dict]:
    """Get events for a task after a given ID."""
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT id, event_type, data_json, created_at FROM task_events "
            "WHERE task_id = %s AND id > %s ORDER BY id LIMIT %s",
            (task_id, after_id, limit),
        )
        rows = cur.fetchall()
    results = []
    for r in rows:
        d = dict(r)
        data = d.pop("data_json", {})
        d["data"] = data if isinstance(data, dict) else json.loads(data or "{}")
        results.append(d)
    return results


def cleanup_task_events(task_id: str):
    """Remove all events for a completed task."""
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM task_events WHERE task_id = %s", (task_id,))


def cleanup_old_events(max_age_hours: int = 48):
    """Remove events older than max_age_hours."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=max_age_hours)).isoformat()
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM task_events WHERE created_at < %s", (cutoff,))


def cleanup_orphan_events():
    """Remove events whose task no longer exists."""
    with get_db_ctx() as cur:
        cur.execute("""
            DELETE FROM task_events
            WHERE task_id NOT IN (SELECT id FROM tasks)
        """)


def cleanup_old_tasks(max_age_days: int = 7):
    """Remove completed/failed/cancelled tasks older than N days."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()
    with get_db_ctx() as cur:
        # First clean their events
        cur.execute("""
            DELETE FROM task_events WHERE task_id IN (
                SELECT id FROM tasks
                WHERE status IN ('completed', 'failed', 'cancelled')
                AND created_at < %s
            )
        """, (cutoff,))
        # Then the tasks themselves
        cur.execute("""
            DELETE FROM tasks
            WHERE status IN ('completed', 'failed', 'cancelled')
            AND created_at < %s
        """, (cutoff,))
