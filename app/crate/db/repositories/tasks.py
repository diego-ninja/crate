from __future__ import annotations

from crate.db.repositories.tasks_claims import claim_next_task
from crate.db.repositories.tasks_maintenance import (
    check_siblings_complete,
    cleanup_orphaned_tasks,
    cleanup_zombie_tasks,
    delete_old_finished_tasks,
    delete_tasks_by_status,
)
from crate.db.repositories.tasks_mutations import (
    create_task,
    create_task_dedup,
    find_active_task_by_type_params,
    heartbeat_task,
    save_scan_result,
    update_task,
)

__all__ = [
    "check_siblings_complete",
    "claim_next_task",
    "cleanup_orphaned_tasks",
    "cleanup_zombie_tasks",
    "create_task",
    "create_task_dedup",
    "find_active_task_by_type_params",
    "delete_old_finished_tasks",
    "delete_tasks_by_status",
    "heartbeat_task",
    "save_scan_result",
    "update_task",
]
