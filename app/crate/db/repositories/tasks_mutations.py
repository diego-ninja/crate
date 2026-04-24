from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.repositories.tasks_shared import dispatch_task, dumps, register_tasks_surface_signal
from crate.db.tx import optional_scope, register_after_commit, transaction_scope


def create_task(
    task_type: str,
    params: dict | None = None,
    *,
    priority: int | None = None,
    pool: str | None = None,
    parent_task_id: str | None = None,
    dispatch: bool = True,
    session=None,
) -> str:
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

    with optional_scope(session) as s:
        register_tasks_surface_signal(s)
        s.execute(
            text(
                """
                INSERT INTO tasks (
                    id,
                    type,
                    status,
                    params_json,
                    priority,
                    pool,
                    parent_task_id,
                    max_duration_sec,
                    max_retries,
                    created_at,
                    updated_at
                )
                VALUES (
                    :id,
                    :type,
                    'pending',
                    :params_json,
                    :priority,
                    :pool,
                    :parent_task_id,
                    :max_duration,
                    :max_retries,
                    :created_at,
                    :updated_at
                )
                """
            ),
            {
                "id": task_id,
                "type": task_type,
                "params_json": dumps(params or {}),
                "priority": priority,
                "pool": pool,
                "parent_task_id": parent_task_id,
                "max_duration": max_duration,
                "max_retries": max_retries,
                "created_at": now,
                "updated_at": now,
            },
        )

        if dispatch:
            register_after_commit(s, lambda: dispatch_task(task_type, task_id))

    return task_id


def create_task_dedup(task_type: str, params: dict | None = None, dedup_key: str = "", dispatch: bool = True) -> str | None:
    from crate.actors import TASK_POOL_CONFIG, get_priority_for_task, get_queue_for_task

    _ = dedup_key
    payload = params or {}
    params_text = dumps(payload, sort_keys=True)
    task_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()

    priority = get_priority_for_task(task_type)
    pool = get_queue_for_task(task_type)
    config = TASK_POOL_CONFIG.get(task_type)
    max_duration = config[2] if config else 1800
    max_retries = config[3] if config else 0

    with transaction_scope() as session:
        register_tasks_surface_signal(session)
        result = session.execute(
            text(
                """
                INSERT INTO tasks (
                    id,
                    type,
                    status,
                    params_json,
                    priority,
                    pool,
                    max_duration_sec,
                    max_retries,
                    created_at,
                    updated_at
                )
                SELECT
                    :id,
                    :type,
                    'pending',
                    :params_json,
                    :priority,
                    :pool,
                    :max_duration,
                    :max_retries,
                    :created_at,
                    :updated_at
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM tasks
                    WHERE type = :type
                      AND status IN ('pending', 'running')
                      AND params_json::text = :params_text
                )
                """
            ),
            {
                "id": task_id,
                "type": task_type,
                "params_json": params_text,
                "priority": priority,
                "pool": pool,
                "max_duration": max_duration,
                "max_retries": max_retries,
                "created_at": now,
                "updated_at": now,
                "params_text": params_text,
            },
        )
        if result.rowcount == 0:
            return None

        if dispatch:
            register_after_commit(session, lambda: dispatch_task(task_type, task_id))

    return task_id


def update_task(
    task_id: str,
    *,
    status: str | None = None,
    progress: str | None = None,
    result: dict | None = None,
    error: str | None = None,
    session=None,
):
    now = datetime.now(timezone.utc).isoformat()
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
        params["set_result_json"] = dumps(result)
    if error is not None:
        fields.append("error = :set_error")
        params["set_error"] = error

    with optional_scope(session) as s:
        register_tasks_surface_signal(s)
        s.execute(text(f"UPDATE tasks SET {', '.join(fields)} WHERE id = :task_id"), params)


def heartbeat_task(task_id: str, *, session=None):
    with optional_scope(session) as s:
        s.execute(
            text("UPDATE tasks SET heartbeat_at = :now WHERE id = :id"),
            {"now": datetime.now(timezone.utc).isoformat(), "id": task_id},
        )


def save_scan_result(task_id: str, issues: list[dict], *, session=None):
    with optional_scope(session) as s:
        s.execute(
            text("INSERT INTO scan_results (task_id, issues_json, scanned_at) VALUES (:task_id, :issues_json, :scanned_at)"),
            {
                "task_id": task_id,
                "issues_json": dumps(issues),
                "scanned_at": datetime.now(timezone.utc).isoformat(),
            },
        )


__all__ = [
    "create_task",
    "create_task_dedup",
    "heartbeat_task",
    "save_scan_result",
    "update_task",
]
