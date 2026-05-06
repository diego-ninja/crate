"""Task scheduler — configurable recurring tasks."""

import logging
import time
from datetime import datetime, timezone

from crate.db.cache_settings import get_setting, set_setting
from crate.db.queries.tasks import list_tasks
from crate.db.repositories.tasks import create_task_dedup

log = logging.getLogger(__name__)

# Default schedule: {task_type: interval_seconds}
DEFAULT_SCHEDULES = {
    "enrich_artists": 86400,       # 24h — full enrichment of all artists
    "library_pipeline": 86400,     # 24h — gated maintenance path (watcher handles real-time)
    "compute_analytics": 14400,    # 4h — recompute analytics from DB
    "check_new_releases": 43200,   # 12h — check MusicBrainz for new releases
    "cleanup_incomplete_downloads": 172800,  # 48h — remove incomplete soulseek downloads
    "sync_shows": 86400,           # 24h — sync shows from Ticketmaster
}


def get_schedules() -> dict[str, int]:
    """Get configured schedules from settings, falling back to defaults."""
    import json
    raw = get_setting("schedules")
    if raw:
        try:
            schedules = json.loads(raw)
            # Migration: rename library_sync → library_pipeline
            if "library_sync" in schedules and "library_pipeline" not in schedules:
                schedules["library_pipeline"] = schedules.pop("library_sync")
                set_schedules(schedules)
            return schedules
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
        from crate.utils import to_datetime
        last_time = to_datetime(last_run)
        if last_time is not None:
            elapsed = (datetime.now(timezone.utc) - last_time).total_seconds()
            if elapsed < interval:
                return False

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
            try:
                from crate.resource_governor import record_decision, should_defer_task

                decision = should_defer_task(task_type)
                if not decision.allowed:
                    record_decision(decision, task_type=task_type, source="scheduler")
                    log.info(
                        "Deferring scheduled task %s due to resource pressure: %s",
                        task_type,
                        decision.reason,
                    )
                    continue
            except Exception:
                log.debug("Resource governor check failed for scheduled %s", task_type, exc_info=True)
            log.info("Scheduling task: %s (interval=%ds)", task_type, interval)
            task_id = create_task_dedup(task_type, dedup_key=f"schedule:{task_type}")
            if task_id:
                mark_run(task_type)
