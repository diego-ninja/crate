from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.repositories.tasks_shared import dispatch_task, log, register_tasks_surface_signal
from crate.db.tx import optional_scope, transaction_scope


def check_siblings_complete(parent_task_id: str) -> dict:
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status IN ('completed','failed','cancelled'))::int AS done,
                    COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
                    COUNT(*) FILTER (WHERE status IN ('failed','cancelled'))::int AS failed
                FROM tasks
                WHERE parent_task_id = :pid
                """
            ),
            {"pid": parent_task_id},
        ).mappings().first()
        total = row["total"] if row else 0
        done = row["done"] if row else 0
        all_done = total > 0 and done == total

        if all_done:
            claimed = session.execute(
                text(
                    """
                    UPDATE tasks
                    SET status = 'completing',
                        updated_at = NOW()
                    WHERE id = :pid AND status IN ('running', 'delegated')
                    """
                ),
                {"pid": parent_task_id},
            )
            if claimed.rowcount == 0:
                all_done = False

    return {
        "all_done": all_done,
        "total": total,
        "completed": row["completed"] if row else 0,
        "failed": row["failed"] if row else 0,
    }


def cleanup_zombie_tasks(heartbeat_timeout_min: int = 5, no_heartbeat_timeout_min: int = 2, *, session=None) -> int:
    recovered: list[dict[str, str]] = []
    with optional_scope(session) as s:
        register_tasks_surface_signal(s)
        rows = s.execute(
            text(
                """
                WITH stale AS (
                    SELECT id, retry_count, max_retries
                    FROM tasks
                    WHERE status = 'running'
                      AND (
                          (heartbeat_at IS NOT NULL
                           AND heartbeat_at < (NOW() - make_interval(mins => :hb_timeout)))
                          OR
                          (heartbeat_at IS NULL
                           AND updated_at < (NOW() - make_interval(mins => :no_hb_timeout)))
                      )
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE tasks t
                SET status = CASE
                        WHEN stale.retry_count < stale.max_retries THEN 'pending'
                        ELSE 'failed'
                    END,
                    retry_count = CASE
                        WHEN stale.retry_count < stale.max_retries THEN stale.retry_count + 1
                        ELSE stale.retry_count
                    END,
                    error = CASE
                        WHEN stale.retry_count < stale.max_retries
                        THEN 'Worker died (no heartbeat); requeued'
                        ELSE 'Worker died (no heartbeat)'
                    END,
                    progress = CASE
                        WHEN stale.retry_count < stale.max_retries
                        THEN 'Retrying after lost worker heartbeat'
                        ELSE t.progress
                    END,
                    updated_at = NOW(),
                    heartbeat_at = NULL,
                    worker_id = NULL
                FROM stale
                WHERE t.id = stale.id
                RETURNING t.id, t.type, t.status
                """
            ),
            {"hb_timeout": heartbeat_timeout_min, "no_hb_timeout": no_heartbeat_timeout_min},
        ).mappings().all()
        recovered = [{"id": str(row["id"]), "type": str(row["type"]), "status": str(row["status"])} for row in rows]

    for task in recovered:
        if task["status"] == "pending":
            dispatch_task(task["type"], task["id"])

    count = len(recovered)
    if count > 0:
        log.warning("Cleaned %d zombie tasks", count)
    return count


def redispatch_stale_pending_tasks(age_seconds: int = 300, limit: int = 100, *, session=None) -> int:
    tasks: list[dict[str, str]] = []
    with optional_scope(session) as s:
        register_tasks_surface_signal(s)
        rows = s.execute(
            text(
                """
                WITH stale AS (
                    SELECT id, type
                    FROM tasks
                    WHERE status = 'pending'
                      AND updated_at < (NOW() - make_interval(secs => :age_seconds))
                    ORDER BY priority ASC, created_at ASC
                    LIMIT :limit
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE tasks t
                SET updated_at = NOW(),
                    progress = CASE
                        WHEN COALESCE(NULLIF(t.progress, ''), '') = ''
                        THEN 'Redispatched after stale pending queue'
                        ELSE t.progress
                    END
                FROM stale
                WHERE t.id = stale.id
                RETURNING t.id, t.type
                """
            ),
            {"age_seconds": max(1, int(age_seconds)), "limit": max(1, int(limit))},
        ).mappings().all()
        tasks = [{"id": str(row["id"]), "type": str(row["type"])} for row in rows]

    for task in tasks:
        dispatch_task(task["type"], task["id"])

    count = len(tasks)
    if count > 0:
        log.warning("Redispatched %d stale pending tasks", count)
    return count


def delete_tasks_by_status(status: str, *, session=None) -> int:
    with optional_scope(session) as s:
        register_tasks_surface_signal(s)
        s.execute(
            text("DELETE FROM task_events WHERE task_id IN (SELECT id FROM tasks WHERE status = :status)"),
            {"status": status},
        )
        s.execute(
            text("DELETE FROM scan_results WHERE task_id IN (SELECT id FROM tasks WHERE status = :status)"),
            {"status": status},
        )
        result = s.execute(text("DELETE FROM tasks WHERE status = :status"), {"status": status})
        return result.rowcount


def delete_old_finished_tasks(cutoff_iso: str, *, session=None) -> int:
    with optional_scope(session) as s:
        register_tasks_surface_signal(s)
        result = s.execute(
            text("DELETE FROM tasks WHERE status IN ('completed', 'failed', 'cancelled') AND created_at < :cutoff"),
            {"cutoff": cutoff_iso},
        )
        return result.rowcount


def cleanup_orphaned_tasks(*, pools: list[str] | None = None, session=None) -> int:
    pool_filter = ""
    params: dict[str, object] = {}
    if pools:
        pool_filter = "AND COALESCE(pool, 'default') = ANY(:pools)"
        params["pools"] = pools
    with optional_scope(session) as s:
        register_tasks_surface_signal(s)
        result = s.execute(
            text(
                f"""
                UPDATE tasks
                SET status = 'failed',
                    error = 'Orphaned: worker restarted',
                    updated_at = NOW(),
                    heartbeat_at = NULL,
                    worker_id = NULL
                WHERE status = 'running'
                  {pool_filter}
                """
            ),
            params,
        )
    count = result.rowcount
    if count > 0:
        log.warning("Marked %d orphaned tasks as failed", count)
    return count


__all__ = [
    "check_siblings_complete",
    "cleanup_orphaned_tasks",
    "cleanup_zombie_tasks",
    "delete_old_finished_tasks",
    "delete_tasks_by_status",
    "redispatch_stale_pending_tasks",
]
