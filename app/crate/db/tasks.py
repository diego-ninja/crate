import uuid
import json
import logging
from datetime import date, datetime, timezone

from sqlalchemy import text

from crate.db.tx import register_after_commit, transaction_scope

log = logging.getLogger(__name__)


def _dumps(obj, **kwargs) -> str:
    return json.dumps(obj, default=_json_default, **kwargs)


def _json_default(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, date):
        return obj.isoformat()
    return str(obj)

# ── Task CRUD ─────────────────────────────────────────────────────


def _dispatch_task(task_type: str, task_id: str) -> None:
    try:
        from crate.actors import dispatch_to_dramatiq

        dispatch_to_dramatiq(task_type, task_id)
    except Exception:
        log.debug(
            "Dramatiq dispatch failed for %s/%s, task stays pending",
            task_type,
            task_id,
            exc_info=True,
        )


def create_task(task_type: str, params: dict | None = None, *,
                priority: int | None = None, pool: str | None = None,
                parent_task_id: str | None = None,
                dispatch: bool = True, session=None) -> str:
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
    if session is None:
        with transaction_scope() as s:
            return create_task(
                task_type,
                params,
                priority=priority,
                pool=pool,
                parent_task_id=parent_task_id,
                dispatch=dispatch,
                session=s,
            )

    session.execute(
        text("""INSERT INTO tasks
           (id, type, status, params_json, priority, pool,
            parent_task_id, max_duration_sec, max_retries, created_at, updated_at)
           VALUES (:id, :type, 'pending', :params_json, :priority, :pool,
                   :parent_task_id, :max_duration, :max_retries, :created_at, :updated_at)"""),
        {"id": task_id, "type": task_type, "params_json": _dumps(params or {}),
         "priority": priority, "pool": pool, "parent_task_id": parent_task_id,
         "max_duration": max_duration, "max_retries": max_retries,
         "created_at": now, "updated_at": now},
    )

    if dispatch:
        register_after_commit(session, lambda: _dispatch_task(task_type, task_id))

    return task_id


def create_task_dedup(task_type: str, params: dict | None = None,
                      dedup_key: str = "", dispatch: bool = True) -> str | None:
    """Create a task only if no pending/running task of the same type+params exists."""
    from crate.actors import get_priority_for_task, get_queue_for_task, TASK_POOL_CONFIG

    p = params or {}
    params_text = _dumps(p, sort_keys=True)
    task_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()

    priority = get_priority_for_task(task_type)
    pool = get_queue_for_task(task_type)
    config = TASK_POOL_CONFIG.get(task_type)
    max_duration = config[2] if config else 1800
    max_retries = config[3] if config else 0

    with transaction_scope() as session:
        result = session.execute(
            text("""INSERT INTO tasks
               (id, type, status, params_json, priority, pool,
                max_duration_sec, max_retries, created_at, updated_at)
               SELECT :id, :type, 'pending', :params_json, :priority, :pool,
                      :max_duration, :max_retries, :created_at, :updated_at
               WHERE NOT EXISTS (
                   SELECT 1 FROM tasks WHERE type = :type AND status IN ('pending', 'running')
                   AND params_json::text = :params_text
               )"""),
            {"id": task_id, "type": task_type, "params_json": params_text,
             "priority": priority, "pool": pool, "max_duration": max_duration,
             "max_retries": max_retries, "created_at": now, "updated_at": now,
             "params_text": params_text},
        )
        if result.rowcount == 0:
            return None

        if dispatch:
            register_after_commit(session, lambda: _dispatch_task(task_type, task_id))

    return task_id


def update_task(task_id: str, *, status: str | None = None, progress: str | None = None,
                result: dict | None = None, error: str | None = None, session=None):
    if session is None:
        with transaction_scope() as s:
            return update_task(task_id, status=status, progress=progress,
                               result=result, error=error, session=s)
    now = datetime.now(timezone.utc).isoformat()
    fields = ["updated_at = :updated_at"]
    params: dict = {"updated_at": now, "task_id": task_id}
    if status is not None:
        fields.append("status = :set_status")
        params["set_status"] = status
        if status == "running":
            fields.append("started_at = :set_started_at")
            params["set_started_at"] = now
    if progress is not None:
        fields.append("progress = :set_progress")
        params["set_progress"] = progress
    if result is not None:
        fields.append("result_json = :set_result_json")
        params["set_result_json"] = _dumps(result)
    if error is not None:
        fields.append("error = :set_error")
        params["set_error"] = error

    session.execute(
        text(f"UPDATE tasks SET {', '.join(fields)} WHERE id = :task_id"),
        params,
    )


def heartbeat_task(task_id: str, *, session=None):
    """Update heartbeat timestamp. Called by worker threads every 30s."""
    if session is None:
        with transaction_scope() as s:
            return heartbeat_task(task_id, session=s)
    now = datetime.now(timezone.utc).isoformat()
    session.execute(
        text("UPDATE tasks SET heartbeat_at = :now WHERE id = :id"),
        {"now": now, "id": task_id},
    )


def get_task(task_id: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT * FROM tasks WHERE id = :id"),
            {"id": task_id},
        ).mappings().first()
    return _row_to_task(row) if row else None


def list_tasks(status: str | None = None, task_type: str | None = None, limit: int = 50) -> list[dict]:
    query = "SELECT * FROM tasks WHERE 1=1"
    params: dict = {}
    if status:
        if status == "running":
            # Include delegated tasks (coordinators waiting for chunks)
            query += " AND status IN ('running', 'delegated', 'completing')"
        else:
            query += " AND status = :status"
            params["status"] = status
    if task_type:
        query += " AND type = :task_type"
        params["task_type"] = task_type
    query += (" ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'delegated' THEN 0 WHEN 'completing' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,"
              " CASE WHEN status IN ('running','pending','delegated','completing') THEN priority ELSE 999 END ASC,"
              " updated_at DESC LIMIT :lim")
    params["lim"] = limit

    with transaction_scope() as session:
        rows = session.execute(text(query), params).mappings().all()
    return [_row_to_task(r) for r in rows]


def list_child_tasks(parent_task_id: str) -> list[dict]:
    """List all sub-tasks of a parent task."""
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT * FROM tasks WHERE parent_task_id = :parent_id ORDER BY created_at"),
            {"parent_id": parent_task_id},
        ).mappings().all()
    return [_row_to_task(r) for r in rows]


def check_siblings_complete(parent_task_id: str) -> dict:
    """Atomically check if all children of a parent task are done AND claim finalization.

    Returns {"all_done": bool, "total": int, "completed": int, "failed": int}.
    A child counts as done if its status is completed, failed, or cancelled.

    When all_done is True, the parent status is atomically set to 'completing'
    (via UPDATE ... WHERE status != 'completing') to ensure exactly one caller
    wins the race and runs finalization. Losers get all_done=False.
    """
    with transaction_scope() as session:
        row = session.execute(
            text("""
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status IN ('completed','failed','cancelled'))::int AS done,
                COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
                COUNT(*) FILTER (WHERE status IN ('failed','cancelled'))::int AS failed
            FROM tasks WHERE parent_task_id = :pid
            """),
            {"pid": parent_task_id},
        ).mappings().first()
        total = row["total"] if row else 0
        done = row["done"] if row else 0
        all_done = total > 0 and done == total

        if all_done:
            # Atomic claim: only one concurrent caller can transition to 'completing'
            claimed = session.execute(
                text("""
                UPDATE tasks SET status = 'completing'
                WHERE id = :pid AND status IN ('running', 'delegated')
                """),
                {"pid": parent_task_id},
            )
            if claimed.rowcount == 0:
                all_done = False  # Another chunk already claimed finalization

    return {
        "all_done": all_done,
        "total": total,
        "completed": row["completed"] if row else 0,
        "failed": row["failed"] if row else 0,
    }


# ── Zombie detection ──────────────────────────────────────────────

def cleanup_zombie_tasks(heartbeat_timeout_min: int = 5, no_heartbeat_timeout_min: int = 2, *, session=None) -> int:
    """Mark tasks as failed if heartbeat is stale or missing.

    - Tasks with heartbeat_at older than heartbeat_timeout_min -> failed
    - Tasks with NULL heartbeat_at and updated_at older than no_heartbeat_timeout_min -> failed
    Returns count of zombies cleaned.
    """
    if session is None:
        with transaction_scope() as s:
            return cleanup_zombie_tasks(heartbeat_timeout_min, no_heartbeat_timeout_min, session=s)
    result = session.execute(text("""
        UPDATE tasks SET status = 'failed', error = 'Worker died (no heartbeat)'
        WHERE status = 'running'
          AND (
              (heartbeat_at IS NOT NULL
               AND heartbeat_at < (NOW() AT TIME ZONE 'UTC' - make_interval(mins => :hb_timeout))::text)
              OR
              (heartbeat_at IS NULL
               AND updated_at < (NOW() AT TIME ZONE 'UTC' - make_interval(mins => :no_hb_timeout))::text)
          )
    """), {"hb_timeout": heartbeat_timeout_min, "no_hb_timeout": no_heartbeat_timeout_min})
    count = result.rowcount
    if count > 0:
        log.warning("Cleaned %d zombie tasks", count)
    return count


def delete_tasks_by_status(status: str, *, session=None) -> int:
    """Delete all tasks (and dependent rows) with the given status."""
    if session is None:
        with transaction_scope() as s:
            return delete_tasks_by_status(status, session=s)
    session.execute(
        text("DELETE FROM task_events WHERE task_id IN (SELECT id FROM tasks WHERE status = :status)"),
        {"status": status},
    )
    session.execute(
        text("DELETE FROM scan_results WHERE task_id IN (SELECT id FROM tasks WHERE status = :status)"),
        {"status": status},
    )
    result = session.execute(
        text("DELETE FROM tasks WHERE status = :status"),
        {"status": status},
    )
    return result.rowcount


def delete_old_finished_tasks(cutoff_iso: str, *, session=None) -> int:
    """Delete completed/failed/cancelled tasks older than the given ISO cutoff."""
    if session is None:
        with transaction_scope() as s:
            return delete_old_finished_tasks(cutoff_iso, session=s)
    result = session.execute(
        text("DELETE FROM tasks WHERE status IN ('completed', 'failed', 'cancelled') AND created_at < :cutoff"),
        {"cutoff": cutoff_iso},
    )
    return result.rowcount


def cleanup_orphaned_tasks(*, session=None) -> int:
    """Mark all running tasks as failed (called on startup)."""
    if session is None:
        with transaction_scope() as s:
            return cleanup_orphaned_tasks(session=s)
    result = session.execute(text("""
        UPDATE tasks SET status = 'failed', error = 'Orphaned: worker restarted'
        WHERE status = 'running'
    """))
    count = result.rowcount
    if count > 0:
        log.warning("Marked %d orphaned tasks as failed", count)
    return count


# ── Legacy compatibility ──────────────────────────────────────────
# claim_next_task is no longer used with Dramatiq but kept for fallback.

DB_HEAVY_TASKS = {"library_sync", "library_pipeline", "wipe_library", "rebuild_library", "repair", "enrich_mbids"}


def claim_next_task(max_running: int = 5) -> dict | None:
    """Legacy: poll-based task claiming. Not used with Dramatiq."""
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'running'")
        ).mappings().first()
        running_count = row["cnt"]
        if running_count >= max_running:
            return None

        row = session.execute(
            text("SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'running' AND type = ANY(:heavy)"),
            {"heavy": list(DB_HEAVY_TASKS)},
        ).mappings().first()
        db_heavy_running = row["cnt"] > 0

        if db_heavy_running:
            row = session.execute(
                text(
                    "SELECT * FROM tasks WHERE status = 'pending' AND type != ALL(:heavy) "
                    "ORDER BY priority ASC, created_at LIMIT 1 FOR UPDATE SKIP LOCKED"
                ),
                {"heavy": list(DB_HEAVY_TASKS)},
            ).mappings().first()
        else:
            row = session.execute(
                text(
                    "SELECT * FROM tasks WHERE status = 'pending' "
                    "ORDER BY priority ASC, created_at LIMIT 1 FOR UPDATE SKIP LOCKED"
                ),
            ).mappings().first()

        if not row:
            return None
        now = datetime.now(timezone.utc).isoformat()
        session.execute(
            text("UPDATE tasks SET status = 'running', updated_at = :now WHERE id = :id AND status = 'pending'"),
            {"now": now, "id": row["id"]},
        )
    return _row_to_task(row) if row else None


# ── Helpers ───────────────────────────────────────────────────────

def _row_to_task(row: dict) -> dict:
    from crate.task_registry import task_label, task_icon

    d = dict(row)
    params_raw = d.pop("params_json", {})
    d["params"] = params_raw if isinstance(params_raw, dict) else json.loads(params_raw or "{}")
    result_raw = d.pop("result_json", None)
    d["result"] = result_raw if isinstance(result_raw, (dict, list)) else (json.loads(result_raw) if result_raw else None)
    d["label"] = task_label(d.get("type", ""))
    d["icon"] = task_icon(d.get("type", ""))
    return d


# ── Scan results ──────────────────────────────────────────────────

def save_scan_result(task_id: str, issues: list[dict], *, session=None):
    if session is None:
        with transaction_scope() as s:
            return save_scan_result(task_id, issues, session=s)
    now = datetime.now(timezone.utc).isoformat()
    session.execute(
        text("INSERT INTO scan_results (task_id, issues_json, scanned_at) VALUES (:task_id, :issues_json, :scanned_at)"),
        {"task_id": task_id, "issues_json": _dumps(issues), "scanned_at": now},
    )


def get_latest_scan() -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT * FROM scan_results ORDER BY scanned_at DESC LIMIT 1")
        ).mappings().first()
    if not row:
        return None
    d = dict(row)
    issues_raw = d.pop("issues_json")
    d["issues"] = issues_raw if isinstance(issues_raw, list) else json.loads(issues_raw)
    return d
