import json
from datetime import datetime, timezone
from musicdock.db.core import get_db_ctx


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


def cleanup_old_events(max_age_hours: int = 24):
    """Remove events older than max_age_hours."""
    with get_db_ctx() as cur:
        cur.execute(
            "DELETE FROM task_events WHERE created_at < (NOW() - INTERVAL '%s hours')::text",
            (max_age_hours,),
        )
