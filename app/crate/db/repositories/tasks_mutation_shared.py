from __future__ import annotations

import uuid
from datetime import datetime, timezone


def new_task_id() -> str:
    return uuid.uuid4().hex[:12]


def task_runtime_config(task_type: str) -> tuple[int, str, int, int]:
    from crate.actors import TASK_POOL_CONFIG, get_priority_for_task, get_queue_for_task

    priority = get_priority_for_task(task_type)
    pool = get_queue_for_task(task_type)
    config = TASK_POOL_CONFIG.get(task_type)
    max_duration = config[2] if config else 1800
    max_retries = config[3] if config else 0
    return priority, pool, max_duration, max_retries


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


__all__ = [
    "new_task_id",
    "task_runtime_config",
    "utc_now_iso",
]
