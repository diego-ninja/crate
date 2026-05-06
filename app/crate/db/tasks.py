"""Legacy compatibility shim for task access.

New runtime code should import from ``crate.db.repositories.tasks`` for writes
and ``crate.db.queries.tasks`` for read-only queries. This module remains only
to keep the deprecated compat surface and older tests/scripts working while the
backend migration finishes.
"""

from crate.db.queries.tasks import get_latest_scan, get_task, list_child_tasks, list_tasks
from crate.db.repositories.tasks import (
    claim_next_task,
    check_siblings_complete,
    cleanup_orphaned_tasks,
    cleanup_zombie_tasks,
    create_task,
    create_task_dedup,
    delete_old_finished_tasks,
    delete_tasks_by_status,
    fail_or_retry_task,
    heartbeat_task,
    redispatch_stale_pending_tasks,
    save_scan_result,
    start_task,
    update_task,
)

__all__ = [
    "claim_next_task",
    "check_siblings_complete",
    "cleanup_orphaned_tasks",
    "cleanup_zombie_tasks",
    "create_task",
    "create_task_dedup",
    "delete_old_finished_tasks",
    "delete_tasks_by_status",
    "fail_or_retry_task",
    "get_latest_scan",
    "get_task",
    "heartbeat_task",
    "list_child_tasks",
    "list_tasks",
    "redispatch_stale_pending_tasks",
    "save_scan_result",
    "start_task",
    "update_task",
]
