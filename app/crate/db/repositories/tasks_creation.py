from __future__ import annotations

from collections.abc import Callable

from sqlalchemy import text

from crate.db.repositories.tasks_mutation_shared import new_task_id, task_runtime_config, utc_now_iso
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
    dispatch_task_fn: Callable[[str, str], None],
    dumps_fn: Callable[..., str],
    register_tasks_surface_signal_fn: Callable[[object], None],
) -> str:
    if priority is None or pool is None:
        default_priority, default_pool, max_duration, max_retries = task_runtime_config(task_type)
        priority = default_priority if priority is None else priority
        pool = default_pool if pool is None else pool
    else:
        _, _, max_duration, max_retries = task_runtime_config(task_type)

    task_id = new_task_id()
    now = utc_now_iso()

    with optional_scope(session) as s:
        register_tasks_surface_signal_fn(s)
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
                "params_json": dumps_fn(params or {}),
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
            register_after_commit(s, lambda: dispatch_task_fn(task_type, task_id))

    return task_id


def create_task_dedup(
    task_type: str,
    params: dict | None = None,
    dedup_key: str = "",
    dispatch: bool = True,
    *,
    dispatch_task_fn: Callable[[str, str], None],
    dumps_fn: Callable[..., str],
    register_tasks_surface_signal_fn: Callable[[object], None],
) -> str | None:
    payload = params or {}
    params_json = dumps_fn(payload, sort_keys=True)
    explicit_dedup_key = dedup_key.strip()
    dedup_identity = explicit_dedup_key or params_json
    dedup_lock_key = f"{task_type}:{dedup_identity}"
    task_id = new_task_id()
    now = utc_now_iso()

    priority, pool, max_duration, max_retries = task_runtime_config(task_type)

    with transaction_scope() as session:
        register_tasks_surface_signal_fn(session)
        session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:dedup_lock_key))"),
            {"dedup_lock_key": dedup_lock_key},
        )
        result = session.execute(
            text(
                """
                INSERT INTO tasks (
                    id,
                    type,
                    status,
                    dedup_key,
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
                    NULLIF(:dedup_key, ''),
                    CAST(:params_json AS jsonb),
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
                      AND status IN ('pending', 'running', 'delegated', 'completing')
                      AND (
                          (:dedup_key <> '' AND dedup_key = :dedup_key)
                          OR (:dedup_key = '' AND params_json = CAST(:params_json AS jsonb))
                      )
                )
                """
            ),
            {
                "id": task_id,
                "type": task_type,
                "dedup_key": explicit_dedup_key,
                "params_json": params_json,
                "priority": priority,
                "pool": pool,
                "max_duration": max_duration,
                "max_retries": max_retries,
                "created_at": now,
                "updated_at": now,
            },
        )
        if result.rowcount == 0:
            return None

        if dispatch:
            register_after_commit(session, lambda: dispatch_task_fn(task_type, task_id))

    return task_id


def find_active_task_by_type_params(
    task_type: str,
    params: dict | None = None,
    *,
    dedup_key: str = "",
    dumps_fn: Callable[..., str],
) -> str | None:
    payload = params or {}
    params_json = dumps_fn(payload, sort_keys=True)
    explicit_dedup_key = dedup_key.strip()
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                SELECT id
                FROM tasks
                WHERE type = :type
                  AND status IN ('pending', 'running', 'delegated', 'completing')
                  AND (
                      (:dedup_key <> '' AND dedup_key = :dedup_key)
                      OR (:dedup_key = '' AND params_json = CAST(:params_json AS jsonb))
                  )
                ORDER BY created_at ASC
                LIMIT 1
                """
            ),
            {
                "type": task_type,
                "dedup_key": explicit_dedup_key,
                "params_json": params_json,
            },
        ).mappings().first()
    return str(row["id"]) if row and row.get("id") else None


__all__ = [
    "create_task",
    "create_task_dedup",
    "find_active_task_by_type_params",
]
