from __future__ import annotations

from sqlalchemy import text

from crate.db.repositories.tasks_mutation_shared import utc_now_iso
from crate.db.tx import optional_scope


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
            fields.append("started_at = :set_started_at")
            params["set_started_at"] = now
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
            text("UPDATE tasks SET heartbeat_at = :now WHERE id = :id"),
            {"now": utc_now_iso(), "id": task_id},
        )


__all__ = [
    "heartbeat_task",
    "update_task",
]
