"""Task scheduler — configurable recurring tasks."""

import logging
import time
from datetime import datetime, timezone

from musicdock.db import get_setting, set_setting, create_task, list_tasks

log = logging.getLogger(__name__)

# Default schedule: {task_type: interval_seconds}
DEFAULT_SCHEDULES = {
    "enrich_artists": 86400,      # 24h — full enrichment of all artists
    "library_sync": 1800,         # 30min — incremental filesystem sync
    "compute_analytics": 3600,    # 1h — recompute analytics from DB
}


def get_schedules() -> dict[str, int]:
    """Get configured schedules from settings, falling back to defaults."""
    import json
    raw = get_setting("schedules")
    if raw:
        try:
            return json.loads(raw)
        except Exception:
            pass
    return dict(DEFAULT_SCHEDULES)


def set_schedules(schedules: dict[str, int]):
    """Save schedule configuration."""
    import json
    set_setting("schedules", json.dumps(schedules))


def should_run(task_type: str, schedules: dict[str, int] | None = None) -> bool:
    """Check if a scheduled task should run now."""
    if schedules is None:
        schedules = get_schedules()

    interval = schedules.get(task_type)
    if not interval or interval <= 0:
        return False  # disabled

    # Check last completion time
    last_key = f"schedule:last_run:{task_type}"
    last_run = get_setting(last_key)

    if last_run:
        try:
            last_time = datetime.fromisoformat(last_run)
            elapsed = (datetime.now(timezone.utc) - last_time).total_seconds()
            if elapsed < interval:
                return False
        except Exception:
            pass

    # Check if already pending/running
    pending = list_tasks(status="pending", task_type=task_type, limit=1)
    running = list_tasks(status="running", task_type=task_type, limit=1)
    if pending or running:
        return False

    return True


def mark_run(task_type: str):
    """Mark a task type as just run."""
    last_key = f"schedule:last_run:{task_type}"
    set_setting(last_key, datetime.now(timezone.utc).isoformat())


def check_and_create_scheduled_tasks():
    """Check all scheduled tasks and create any that are due."""
    schedules = get_schedules()

    for task_type, interval in schedules.items():
        if interval <= 0:
            continue
        if should_run(task_type, schedules):
            log.info("Scheduling task: %s (interval=%ds)", task_type, interval)
            create_task(task_type)
            mark_run(task_type)
