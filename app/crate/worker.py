import logging
import threading

from crate.db.cache_store import set_cache
from crate.db.core import init_db
from crate.db.queries.tasks import get_task, get_task_activity_snapshot
from crate.db.repositories.tasks import cleanup_orphaned_tasks, cleanup_zombie_tasks
from crate.worker_handlers.acquisition import ACQUISITION_TASK_HANDLERS
from crate.worker_handlers.analysis import ANALYSIS_TASK_HANDLERS
from crate.worker_handlers.artwork import ARTWORK_TASK_HANDLERS
from crate.worker_handlers.enrichment import ENRICHMENT_TASK_HANDLERS
from crate.worker_handlers.integrations import INTEGRATION_TASK_HANDLERS
from crate.worker_handlers.library import LIBRARY_TASK_HANDLERS
from crate.worker_handlers.management import MANAGEMENT_TASK_HANDLERS
from crate.worker_handlers.migration import MIGRATION_TASK_HANDLERS

log = logging.getLogger(__name__)


def _is_cancelled(task_id: str) -> bool:
    try:
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

    # Start projector daemon (domain events → snapshot warming)
    projector_thread = threading.Thread(
        target=_run_projector_loop, args=(service_stop,), daemon=True, name="projector",
    )
    projector_thread.start()
    log.info("Projector daemon started")

    # Start Telegram bot
    from crate.telegram import telegram_bot_loop
    telegram_thread = threading.Thread(
        target=telegram_bot_loop, args=(config,), daemon=True, name="telegram-bot",
    )
    telegram_thread.start()

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


def _run_projector_loop(stop_event: threading.Event):
    """Dedicated thread: consume domain events from Redis Stream and warm snapshots."""
    from crate.projector import process_domain_events

    while not stop_event.is_set():
        try:
            process_domain_events(limit=200)
        except Exception:
            log.debug("Snapshot projector failed", exc_info=True)
        stop_event.wait(5)
    log.info("Projector loop stopped")


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
    last_metrics_flush = 0
    last_shadow_backfill = 0

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
                count = len(queue.refresh_pending_state())
                set_cache("imports_pending", {"count": count})
            except Exception:
                pass

        # Zombie task cleanup every 30s (heartbeat-based)
        if now - last_zombie_check > 30:
            last_zombie_check = now
            try:
                cleanup_zombie_tasks(heartbeat_timeout_min=5, no_heartbeat_timeout_min=3)
            except Exception:
                log.debug("Zombie cleanup failed", exc_info=True)

        # Worker status cache + queue depth metrics every 15s
        if now - last_status_update > 15:
            last_status_update = now
            try:
                from crate.db.cache_settings import get_setting
                from crate.db.ops_runtime import set_ops_runtime_state
                activity = get_task_activity_snapshot(running_limit=100, pending_limit=100, recent_limit=10)
                running = activity["running_tasks"]
                pending = activity["pending_tasks"]
                recent = activity["recent_tasks"]
                max_workers = int(get_setting("max_workers", str(config.get("worker_processes", 6))) or config.get("worker_processes", 6) or 6)
                scan_running = next((task for task in running if task.get("type") == "scan"), None)
                worker_live = {
                    "engine": "dramatiq",
                    "running_count": int(activity["running_count"]),
                    "pending_count": int(activity["pending_count"]),
                    "running_tasks": [
                        {
                            "id": task["id"],
                            "type": task["type"],
                            "status": task["status"],
                            "pool": task.get("pool", "default"),
                            "progress": task.get("progress", ""),
                            "created_at": task.get("created_at"),
                            "started_at": task.get("started_at"),
                            "updated_at": task.get("updated_at"),
                        }
                        for task in running
                    ],
                    "pending_tasks": [
                        {
                            "id": task["id"],
                            "type": task["type"],
                            "status": task["status"],
                            "pool": task.get("pool", "default"),
                            "progress": task.get("progress", ""),
                            "created_at": task.get("created_at"),
                            "started_at": task.get("started_at"),
                            "updated_at": task.get("updated_at"),
                        }
                        for task in pending[:12]
                    ],
                    "recent_tasks": [
                        {
                            "id": task["id"],
                            "type": task["type"],
                            "status": task["status"],
                            "updated_at": task.get("updated_at"),
                        }
                        for task in recent
                    ],
                    "worker_slots": {
                        "max": max_workers,
                        "active": int(activity["running_count"]),
                    },
                    "queue_breakdown": activity.get("queue_breakdown") or {
                        "running": {"fast": 0, "default": 0, "heavy": 0},
                        "pending": {"fast": 0, "default": 0, "heavy": 0},
                    },
                    "db_heavy_gate": activity.get("db_heavy_gate") or {
                        "active": 0,
                        "pending": 0,
                        "blocking": False,
                    },
                    "scan": {
                        "running": scan_running is not None,
                        "progress": (scan_running or {}).get("progress", {}) if scan_running else {},
                    },
                    "systems": {
                        "postgres": True,
                        "watcher": True,
                    },
                }
                set_cache("worker_status", {
                    "running": int(activity["running_count"]),
                    "pending": int(activity["pending_count"]),
                    "engine": "dramatiq",
                }, ttl=60)
                set_ops_runtime_state("worker_live", worker_live)
                # Record queue depth as a metric
                try:
                    from crate.metrics import record
                    record("worker.queue.depth", int(activity["pending_count"]))
                    record("worker.queue.running", int(activity["running_count"]))
                except Exception:
                    pass
            except Exception:
                pass

        # Metrics flush every 5 minutes
        if now - last_metrics_flush > 300:
            last_metrics_flush = now
            try:
                from crate.metrics import flush_to_postgres
                flush_to_postgres()
            except Exception:
                log.debug("Metrics flush failed", exc_info=True)

        # Incrementally backfill shadow pipeline read models every 30s
        if now - last_shadow_backfill > 30:
            last_shadow_backfill = now
            try:
                from crate.db.jobs.analysis import backfill_pipeline_read_models

                result = backfill_pipeline_read_models(limit=1000)
                if any(result.values()):
                    log.info(
                        "Pipeline shadow backfill: analysis=%d bliss=%d features=%d embeddings=%d",
                        result["processing_analysis"],
                        result["processing_bliss"],
                        result["analysis_features"],
                        result["bliss_embeddings"],
                    )
            except Exception:
                log.debug("Pipeline shadow backfill failed", exc_info=True)

        # Old task/event/log cleanup every hour
        if now - last_cleanup > 3600:
            last_cleanup = now
            try:
                from crate.db.events import cleanup_old_events, cleanup_old_tasks
                from crate.db.repositories.auth import cleanup_expired_sessions, cleanup_ended_jam_rooms
                from crate.db.worker_logs import cleanup_old_logs
                cleanup_old_events(max_age_hours=48)
                cleanup_old_tasks(max_age_days=7)
                cleanup_expired_sessions(max_age_days=3, stale_age_days=30)
                cleanup_ended_jam_rooms(max_age_days=30)
                cleanup_old_logs(max_age_days=7)
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
