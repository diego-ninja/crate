import uuid
import json
import logging
from datetime import datetime, timezone
from crate.db.core import get_db_ctx

log = logging.getLogger(__name__)

# ── Task CRUD ─────────────────────────────────────────────────────

def create_task(task_type: str, params: dict | None = None, *,
                priority: int | None = None, pool: str | None = None,
                parent_task_id: str | None = None,
                dispatch: bool = True) -> str:
    """Create a task in PG and optionally dispatch to Dramatiq.

    If priority/pool are not provided, defaults are looked up from TASK_POOL_CONFIG.
    dispatch=True (default) sends the task to Dramatiq for execution.
    dispatch=False just creates the PG row (useful for coordinator sub-tasks).
    """
    from crate.actors import TASK_POOL_CONFIG, get_priority_for_task, get_queue_for_task

    if priority is None:
        priority = get_priority_for_task(task_type)
    if pool is None:
        pool = get_queue_for_task(task_type)

    config = TASK_POOL_CONFIG.get(task_type)
    max_duration = config[2] if config else 1800
    max_retries = config[3] if config else 0

    task_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            """INSERT INTO tasks
               (id, type, status, params_json, priority, pool,
                parent_task_id, max_duration_sec, max_retries, created_at, updated_at)
               VALUES (%s, %s, 'pending', %s, %s, %s, %s, %s, %s, %s, %s)""",
            (task_id, task_type, json.dumps(params or {}),
             priority, pool, parent_task_id, max_duration, max_retries, now, now),
        )

    if dispatch:
        try:
            from crate.actors import dispatch_to_dramatiq
            dispatch_to_dramatiq(task_type, task_id)
        except Exception:
            log.debug("Dramatiq dispatch failed for %s/%s, task stays pending",
                      task_type, task_id, exc_info=True)

    return task_id


def create_task_dedup(task_type: str, params: dict | None = None,
                      dedup_key: str = "", dispatch: bool = True) -> str | None:
    """Create a task only if no pending/running task of the same type+params exists."""
    from crate.actors import get_priority_for_task, get_queue_for_task, TASK_POOL_CONFIG

    p = params or {}
    params_text = json.dumps(p, sort_keys=True)
    task_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()

    priority = get_priority_for_task(task_type)
    pool = get_queue_for_task(task_type)
    config = TASK_POOL_CONFIG.get(task_type)
    max_duration = config[2] if config else 1800
    max_retries = config[3] if config else 0

    with get_db_ctx() as cur:
        cur.execute(
            """INSERT INTO tasks
               (id, type, status, params_json, priority, pool,
                max_duration_sec, max_retries, created_at, updated_at)
               SELECT %s, %s, 'pending', %s, %s, %s, %s, %s, %s, %s
               WHERE NOT EXISTS (
                   SELECT 1 FROM tasks WHERE type = %s AND status IN ('pending', 'running')
                   AND params_json::text = %s
               )""",
            (task_id, task_type, params_text, priority, pool,
             max_duration, max_retries, now, now,
             task_type, params_text),
        )
        if cur.rowcount == 0:
            return None  # duplicate

    if dispatch:
        try:
            from crate.actors import dispatch_to_dramatiq
            dispatch_to_dramatiq(task_type, task_id)
        except Exception:
            log.debug("Dramatiq dispatch failed for %s/%s", task_type, task_id, exc_info=True)

    return task_id


def update_task(task_id: str, *, status: str | None = None, progress: str | None = None,
                result: dict | None = None, error: str | None = None):
    now = datetime.now(timezone.utc).isoformat()
    fields = ["updated_at = %s"]
    values: list = [now]

    if status is not None:
        fields.append("status = %s")
        values.append(status)
        if status == "running":
            fields.append("started_at = %s")
            values.append(now)
    if progress is not None:
        fields.append("progress = %s")
        values.append(progress)
    if result is not None:
        fields.append("result_json = %s")
        values.append(json.dumps(result))
    if error is not None:
        fields.append("error = %s")
        values.append(error)

    values.append(task_id)
    with get_db_ctx() as cur:
        cur.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id = %s", values)


def heartbeat_task(task_id: str):
    """Update heartbeat timestamp. Called by worker threads every 30s."""
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute("UPDATE tasks SET heartbeat_at = %s WHERE id = %s", (now, task_id))


def get_task(task_id: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM tasks WHERE id = %s", (task_id,))
        row = cur.fetchone()
    return _row_to_task(row) if row else None


def list_tasks(status: str | None = None, task_type: str | None = None, limit: int = 50) -> list[dict]:
    query = "SELECT * FROM tasks WHERE 1=1"
    params: list = []
    if status:
        query += " AND status = %s"
        params.append(status)
    if task_type:
        query += " AND type = %s"
        params.append(task_type)
    query += (" ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,"
              " priority ASC, created_at DESC LIMIT %s")
    params.append(limit)

    with get_db_ctx() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()
    return [_row_to_task(r) for r in rows]


def list_child_tasks(parent_task_id: str) -> list[dict]:
    """List all sub-tasks of a parent task."""
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM tasks WHERE parent_task_id = %s ORDER BY created_at",
            (parent_task_id,),
        )
        rows = cur.fetchall()
    return [_row_to_task(r) for r in rows]


# ── Zombie detection ──────────────────────────────────────────────

def cleanup_zombie_tasks(heartbeat_timeout_min: int = 5, no_heartbeat_timeout_min: int = 2) -> int:
    """Mark tasks as failed if heartbeat is stale or missing.

    - Tasks with heartbeat_at older than heartbeat_timeout_min → failed
    - Tasks with NULL heartbeat_at and updated_at older than no_heartbeat_timeout_min → failed
    Returns count of zombies cleaned.
    """
    with get_db_ctx() as cur:
        cur.execute("""
            UPDATE tasks SET status = 'failed', error = 'Worker died (no heartbeat)'
            WHERE status = 'running'
              AND (
                  (heartbeat_at IS NOT NULL
                   AND heartbeat_at < (NOW() AT TIME ZONE 'UTC' - INTERVAL '%s minutes')::text)
                  OR
                  (heartbeat_at IS NULL
                   AND updated_at < (NOW() AT TIME ZONE 'UTC' - INTERVAL '%s minutes')::text)
              )
        """, (heartbeat_timeout_min, no_heartbeat_timeout_min))
        count = cur.rowcount
    if count > 0:
        log.warning("Cleaned %d zombie tasks", count)
    return count


def cleanup_orphaned_tasks() -> int:
    """Mark all running tasks as failed (called on startup)."""
    with get_db_ctx() as cur:
        cur.execute("""
            UPDATE tasks SET status = 'failed', error = 'Orphaned: worker restarted'
            WHERE status = 'running'
        """)
        count = cur.rowcount
    if count > 0:
        log.warning("Marked %d orphaned tasks as failed", count)
    return count


# ── Legacy compatibility ──────────────────────────────────────────
# claim_next_task is no longer used with Dramatiq but kept for fallback.

DB_HEAVY_TASKS = {"library_sync", "library_pipeline", "wipe_library", "rebuild_library", "repair", "enrich_mbids"}


def claim_next_task(max_running: int = 5) -> dict | None:
    """Legacy: poll-based task claiming. Not used with Dramatiq."""
    with get_db_ctx() as cur:
        cur.execute("SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'running'")
        running_count = cur.fetchone()["cnt"]
        if running_count >= max_running:
            return None

        cur.execute(
            "SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'running' AND type = ANY(%s)",
            (list(DB_HEAVY_TASKS),),
        )
        db_heavy_running = cur.fetchone()["cnt"] > 0

        if db_heavy_running:
            cur.execute(
                "SELECT * FROM tasks WHERE status = 'pending' AND type != ALL(%s) "
                "ORDER BY priority ASC, created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
                (list(DB_HEAVY_TASKS),),
            )
        else:
            cur.execute(
                "SELECT * FROM tasks WHERE status = 'pending' "
                "ORDER BY priority ASC, created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
            )

        row = cur.fetchone()
        if not row:
            return None
        now = datetime.now(timezone.utc).isoformat()
        cur.execute(
            "UPDATE tasks SET status = 'running', updated_at = %s WHERE id = %s AND status = 'pending'",
            (now, row["id"]),
        )
    return _row_to_task(row) if row else None


# ── Helpers ───────────────────────────────────────────────────────

def _row_to_task(row: dict) -> dict:
    d = dict(row)
    params_raw = d.pop("params_json", {})
    d["params"] = params_raw if isinstance(params_raw, dict) else json.loads(params_raw or "{}")
    result_raw = d.pop("result_json", None)
    d["result"] = result_raw if isinstance(result_raw, (dict, list)) else (json.loads(result_raw) if result_raw else None)
    return d


# ── Scan results ──────────────────────────────────────────────────

def save_scan_result(task_id: str, issues: list[dict]):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO scan_results (task_id, issues_json, scanned_at) VALUES (%s, %s, %s)",
            (task_id, json.dumps(issues), now),
        )


def get_latest_scan() -> dict | None:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM scan_results ORDER BY scanned_at DESC LIMIT 1"
        )
        row = cur.fetchone()
    if not row:
        return None
    d = dict(row)
    issues_raw = d.pop("issues_json")
    d["issues"] = issues_raw if isinstance(issues_raw, list) else json.loads(issues_raw)
    return d
