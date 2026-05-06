from __future__ import annotations

from sqlalchemy import text

from crate.db.repositories.tasks_mutation_shared import utc_now_iso
from crate.db.repositories.tasks_shared import register_tasks_surface_signal
from crate.db.tx import optional_scope


ACTIVE_STATUSES = {"running", "delegated", "completing"}
TERMINAL_STATUSES = {"completed", "failed", "cancelled"}


def start_task(task_id: str, *, worker_id: str | None = None, session=None) -> dict | None:
    now = utc_now_iso()
    with optional_scope(session) as s:
        register_tasks_surface_signal(s)
        row = s.execute(
            text(
                """
                UPDATE tasks
                SET status = 'running',
                    started_at = COALESCE(started_at, :now),
                    updated_at = :now,
                    heartbeat_at = :now,
                    worker_id = :worker_id,
                    error = NULL
                WHERE id = :id
                  AND status = 'pending'
                RETURNING *
                """
            ),
            {"now": now, "worker_id": worker_id, "id": task_id},
        ).mappings().first()
    return dict(row) if row else None


def update_task(
    task_id: str,
    *,
    status: str | None = None,
    progress: str | None = None,
    result: dict | None = None,
    error: str | None = None,
    session=None,
    dumps_fn,
    register_tasks_surface_signal_fn,
):
    now = utc_now_iso()
    fields = ["updated_at = :updated_at"]
    params: dict[str, object] = {"updated_at": now, "task_id": task_id}
    if status is not None:
        fields.append("status = :set_status")
        params["set_status"] = status
        if status == "running":
            fields.append("started_at = COALESCE(started_at, :set_started_at)")
            fields.append("heartbeat_at = :set_started_at")
            params["set_started_at"] = now
        elif status in ACTIVE_STATUSES:
            fields.append("heartbeat_at = NULL")
            fields.append("worker_id = NULL")
        elif status in TERMINAL_STATUSES:
            fields.append("heartbeat_at = NULL")
            fields.append("worker_id = NULL")
    if progress is not None:
        fields.append("progress = :set_progress")
        params["set_progress"] = progress
    if result is not None:
        fields.append("result_json = :set_result_json")
        params["set_result_json"] = dumps_fn(result)
    if error is not None:
        fields.append("error = :set_error")
        params["set_error"] = error

    with optional_scope(session) as s:
        register_tasks_surface_signal_fn(s)
        s.execute(text(f"UPDATE tasks SET {', '.join(fields)} WHERE id = :task_id"), params)


def heartbeat_task(task_id: str, *, session=None):
    with optional_scope(session) as s:
        s.execute(
            text(
                """
                UPDATE tasks
                SET heartbeat_at = :now,
                    updated_at = :now
                WHERE id = :id
                  AND status = 'running'
                """
            ),
            {"now": utc_now_iso(), "id": task_id},
        )


def fail_or_retry_task(task_id: str, error: str, *, session=None) -> str:
    now = utc_now_iso()
    trimmed_error = str(error or "Task failed")[:500]

    with optional_scope(session) as s:
        register_tasks_surface_signal(s)
        row = s.execute(
            text(
                """
                SELECT status, retry_count, max_retries
                FROM tasks
                WHERE id = :id
                FOR UPDATE
                """
            ),
            {"id": task_id},
        ).mappings().first()
        if not row:
            return "missing"

        status = str(row.get("status") or "")
        if status in TERMINAL_STATUSES:
            return status

        retry_count = int(row.get("retry_count") or 0)
        max_retries = int(row.get("max_retries") or 0)
        if retry_count < max_retries:
            next_retry = retry_count + 1
            s.execute(
                text(
                    """
                    UPDATE tasks
                    SET status = 'pending',
                        retry_count = :retry_count,
                        updated_at = :now,
                        heartbeat_at = NULL,
                        worker_id = NULL,
                        error = :error,
                        progress = :progress
                    WHERE id = :id
                    """
                ),
                {
                    "id": task_id,
                    "retry_count": next_retry,
                    "now": now,
                    "error": trimmed_error,
                    "progress": f"Retrying after worker error ({next_retry}/{max_retries})",
                },
            )
            return "retrying"

        s.execute(
            text(
                """
                UPDATE tasks
                SET status = 'failed',
                    updated_at = :now,
                    heartbeat_at = NULL,
                    worker_id = NULL,
                    error = :error
                WHERE id = :id
                """
            ),
            {"id": task_id, "now": now, "error": trimmed_error},
        )
        return "failed"


__all__ = [
    "fail_or_retry_task",
    "heartbeat_task",
    "start_task",
    "update_task",
]
