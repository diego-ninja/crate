from __future__ import annotations

import json
import logging
from datetime import date, datetime

from crate.db.tx import register_after_commit

log = logging.getLogger(__name__)

DB_HEAVY_TASKS = {
    "library_sync",
    "library_pipeline",
    "wipe_library",
    "rebuild_library",
    "repair",
    "enrich_mbids",
    "migrate_storage_v2",
    "fix_artist",
}
TASKS_SURFACE_AFTER_COMMIT_KEY = "_tasks_surface_signal_registered"


def json_default(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, date):
        return obj.isoformat()
    return str(obj)


def dumps(obj, **kwargs) -> str:
    return json.dumps(obj, default=json_default, **kwargs)


def dispatch_task(task_type: str, task_id: str) -> None:
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


def publish_tasks_surface_signal() -> None:
    try:
        from crate.db.admin_tasks_surface import publish_tasks_surface_signal as _publish

        _publish()
    except Exception:
        log.debug("Failed to publish tasks surface signal", exc_info=True)


def register_tasks_surface_signal(session) -> None:
    if session.info.get(TASKS_SURFACE_AFTER_COMMIT_KEY):
        return
    register_after_commit(session, publish_tasks_surface_signal)
    session.info[TASKS_SURFACE_AFTER_COMMIT_KEY] = True


__all__ = [
    "DB_HEAVY_TASKS",
    "dispatch_task",
    "dumps",
    "log",
    "publish_tasks_surface_signal",
    "register_tasks_surface_signal",
]
