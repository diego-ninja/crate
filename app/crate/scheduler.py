"""Task scheduler — configurable recurring tasks."""

import logging
import time
from datetime import datetime, timezone

from crate.db import get_setting, set_setting, create_task, list_tasks

log = logging.getLogger(__name__)

# Default schedule: {task_type: interval_seconds}
DEFAULT_SCHEDULES = {
    "enrich_artists": 86400,       # 24h — full enrichment of all artists
    "library_pipeline": 21600,     # 6h — health check + repair + sync (watcher handles real-time)
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
            log.info("Scheduling task: %s (interval=%ds)", task_type, interval)
            create_task(task_type)
            mark_run(task_type)

    # Last.fm scrapes per unique user city — disabled by default.
    # Enable via admin settings: lastfm_scraping_enabled = true
    # Can always be triggered manually via Command Palette or API.
    #
    # if should_run("sync_shows_lastfm", schedules):
    #     try:
    #         from crate.db.shows import get_unique_user_cities
    #         from crate.db import get_setting
    #         if get_setting("lastfm_scraping_enabled", "true") == "true":
    #             cities = get_unique_user_cities()
    #             for city_row in cities:
    #                 create_task("sync_shows_lastfm", {
    #                     "city": city_row["city"],
    #                     "latitude": city_row["latitude"],
    #                     "longitude": city_row["longitude"],
    #                 })
    #             if cities:
    #                 log.info("Scheduled Last.fm scrape for %d cities", len(cities))
    #                 mark_run("sync_shows_lastfm")
    #     except Exception:
    #         log.debug("Failed to schedule Last.fm scrapes", exc_info=True)
