import logging
import threading

from crate.db import set_cache
from crate.worker_handlers.acquisition import ACQUISITION_TASK_HANDLERS
from crate.worker_handlers.analysis import ANALYSIS_TASK_HANDLERS
from crate.worker_handlers.artwork import ARTWORK_TASK_HANDLERS
from crate.worker_handlers.enrichment import ENRICHMENT_TASK_HANDLERS
from crate.worker_handlers.integrations import INTEGRATION_TASK_HANDLERS
from crate.worker_handlers.library import LIBRARY_TASK_HANDLERS
from crate.worker_handlers.management import MANAGEMENT_TASK_HANDLERS
from crate.worker_handlers.migration import MIGRATION_TASK_HANDLERS

log = logging.getLogger(__name__)

# DB_HEAVY_TASKS moved to db/tasks.py for claim_next_task logic
DB_HEAVY_TASKS = {"library_sync", "library_pipeline", "wipe_library", "rebuild_library", "repair", "enrich_mbids", "migrate_storage_v2"}


def _is_cancelled(task_id: str) -> bool:
    try:
        from crate.db import get_task

        task = get_task(task_id)
        return task is not None and task.get("status") == "cancelled"
    except Exception:
        return False


def run_worker(config: dict):
    """Start Dramatiq workers + scheduler/watcher service loop."""
    import subprocess
    import signal
    import sys
    import threading

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    from crate.db import init_db
    from crate.db.tasks import cleanup_orphaned_tasks
    from crate.utils import init_musicbrainz

    init_db()
    init_musicbrainz()
    cleanup_orphaned_tasks()

    # Clear stale locks from previous run
    from crate.actors import clear_db_heavy_lock, clear_download_slots
    clear_db_heavy_lock()
    clear_download_slots()

    # Start scheduler + watcher + zombie cleanup in background thread
    service_stop = threading.Event()
    service_thread = threading.Thread(
        target=_run_service_loop, args=(config, service_stop), daemon=True,
    )
    service_thread.start()
    log.info("Service loop started (scheduler + watcher + zombie cleanup)")

    # Start background analysis daemons (independent of Dramatiq tasks)
    from crate.analysis_daemon import analysis_daemon, bliss_daemon
    analysis_thread = threading.Thread(
        target=analysis_daemon, args=(config,), daemon=True, name="analysis-daemon",
    )
    bliss_thread = threading.Thread(
        target=bliss_daemon, args=(config,), daemon=True, name="bliss-daemon",
    )
    analysis_thread.start()
    bliss_thread.start()
    log.info("Background analysis daemons started")

    # Start Dramatiq workers via CLI (this manages its own process pool)
    dramatiq_cmd = [
        sys.executable, "-m", "dramatiq",
        "crate.actors",
        "--processes", str(config.get("worker_processes", 6)),
        "--threads", "1",
        "--queues", "fast", "heavy", "default",
    ]
    log.info("Starting Dramatiq: %s", " ".join(dramatiq_cmd))
    proc = subprocess.Popen(dramatiq_cmd)

    def handle_signal(signum, frame):
        log.info("Received signal %d, shutting down...", signum)
        service_stop.set()
        proc.send_signal(signum)

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    exit_code = proc.wait()
    service_stop.set()
    log.info("Dramatiq exited with code %d", exit_code)
    sys.exit(exit_code)


def _run_service_loop(config: dict, stop_event: threading.Event):
    """Background thread: scheduler checks, watcher, zombie cleanup, import queue."""
    import time as _time

    # Start filesystem watcher
    watcher = None
    try:
        from crate.library_sync import LibrarySync
        from crate.library_watcher import LibraryWatcher
        sync = LibrarySync(config)
        watcher = LibraryWatcher(config, sync)
        watcher.start()
        log.info("Filesystem watcher started")
    except Exception:
        log.warning("Library watcher failed to start", exc_info=True)

    last_schedule_check = 0
    last_zombie_check = 0
    last_import_check = 0
    last_cleanup = 0
    last_status_update = 0

    while not stop_event.is_set():
        now = _time.time()

        # Scheduled tasks every 60s
        if now - last_schedule_check > 60:
            last_schedule_check = now
            try:
                from crate.scheduler import check_and_create_scheduled_tasks
                check_and_create_scheduled_tasks()
            except Exception:
                log.debug("Schedule check failed", exc_info=True)

        # Import queue scan every 60s
        if now - last_import_check > 60:
            last_import_check = now
            try:
                from crate.importer import ImportQueue
                from crate.config import load_config
                queue = ImportQueue(load_config())
                count = len(queue.scan_pending())
                set_cache("imports_pending", {"count": count})
            except Exception:
                pass

        # Zombie task cleanup every 30s (heartbeat-based)
        if now - last_zombie_check > 30:
            last_zombie_check = now
            try:
                from crate.db.tasks import cleanup_zombie_tasks
                cleanup_zombie_tasks(heartbeat_timeout_min=5, no_heartbeat_timeout_min=3)
            except Exception:
                log.debug("Zombie cleanup failed", exc_info=True)

        # Worker status cache every 15s
        if now - last_status_update > 15:
            last_status_update = now
            try:
                from crate.db import list_tasks as _lt
                running = _lt(status="running", limit=100)
                pending = _lt(status="pending", limit=100)
                set_cache("worker_status", {
                    "running": len(running),
                    "pending": len(pending),
                    "engine": "dramatiq",
                }, ttl=60)
            except Exception:
                pass

        # Old task/event cleanup every hour
        if now - last_cleanup > 3600:
            last_cleanup = now
            try:
                from crate.db.events import cleanup_old_events, cleanup_old_tasks
                from crate.db.auth import cleanup_expired_sessions, cleanup_ended_jam_rooms
                cleanup_old_events(max_age_hours=48)
                cleanup_old_tasks(max_age_days=7)
                cleanup_expired_sessions(max_age_days=7)
                cleanup_ended_jam_rooms(max_age_days=30)
            except Exception:
                log.debug("Auto-cleanup failed")

        stop_event.wait(2)

    # Shutdown watcher
    if watcher:
        try:
            watcher.stop()
        except Exception:
            pass
    log.info("Service loop stopped")


TASK_HANDLERS = {
}

TASK_HANDLERS.update(ACQUISITION_TASK_HANDLERS)
TASK_HANDLERS.update(ANALYSIS_TASK_HANDLERS)
TASK_HANDLERS.update(ARTWORK_TASK_HANDLERS)
TASK_HANDLERS.update(ENRICHMENT_TASK_HANDLERS)
TASK_HANDLERS.update(INTEGRATION_TASK_HANDLERS)
TASK_HANDLERS.update(LIBRARY_TASK_HANDLERS)
TASK_HANDLERS.update(MANAGEMENT_TASK_HANDLERS)
TASK_HANDLERS.update(MIGRATION_TASK_HANDLERS)
