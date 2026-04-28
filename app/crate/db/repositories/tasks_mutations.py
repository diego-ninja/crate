from __future__ import annotations

from crate.db.repositories.tasks_creation import create_task as _create_task
from crate.db.repositories.tasks_creation import create_task_dedup as _create_task_dedup
from crate.db.repositories.tasks_scan_results import save_scan_result as _save_scan_result
from crate.db.repositories.tasks_shared import dispatch_task, dumps, register_tasks_surface_signal
from crate.db.repositories.tasks_updates import heartbeat_task as _heartbeat_task
from crate.db.repositories.tasks_updates import update_task as _update_task


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
    return _create_task(
        task_type,
        params,
        priority=priority,
        pool=pool,
        parent_task_id=parent_task_id,
        dispatch=dispatch,
        session=session,
        dispatch_task_fn=dispatch_task,
        dumps_fn=dumps,
        register_tasks_surface_signal_fn=register_tasks_surface_signal,
    )


def create_task_dedup(task_type: str, params: dict | None = None, dedup_key: str = "", dispatch: bool = True) -> str | None:
    return _create_task_dedup(
        task_type,
        params,
        dedup_key,
        dispatch,
        dispatch_task_fn=dispatch_task,
        dumps_fn=dumps,
        register_tasks_surface_signal_fn=register_tasks_surface_signal,
    )


def update_task(
    task_id: str,
    *,
    status: str | None = None,
    progress: str | None = None,
    result: dict | None = None,
    error: str | None = None,
    session=None,
):
    _update_task(
        task_id,
        status=status,
        progress=progress,
        result=result,
        error=error,
        session=session,
        dumps_fn=dumps,
        register_tasks_surface_signal_fn=register_tasks_surface_signal,
    )


def heartbeat_task(task_id: str, *, session=None):
    _heartbeat_task(task_id, session=session)


def save_scan_result(task_id: str, issues: list[dict], *, session=None):
    _save_scan_result(task_id, issues, session=session, dumps_fn=dumps)


__all__ = [
    "create_task",
    "create_task_dedup",
    "heartbeat_task",
    "save_scan_result",
    "update_task",
]
