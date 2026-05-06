"""Worker orchestrator — manages worker processes, scheduler, and watcher."""

import json
import logging
import multiprocessing
import os
import signal
import threading
import time

from crate.config import load_config
from crate.db.cache_settings import get_setting
from crate.db.cache_store import set_cache
from crate.db.core import init_db
from crate.db.queries.tasks import list_tasks
from crate.db.repositories.tasks import claim_next_task, fail_or_retry_task, heartbeat_task, update_task

log = logging.getLogger(__name__)

DEFAULT_MIN_WORKERS = 2
DEFAULT_MAX_WORKERS = 5
MAX_TASKS_BEFORE_RECYCLE = 200
MAX_RSS_MB = 1500  # 1.5 GB
SCALE_CHECK_INTERVAL = 30  # seconds
HEALTH_CHECK_INTERVAL = 10


class WorkerProcess:
    """Tracks a single worker child process."""

    def __init__(self, process: multiprocessing.Process, worker_id: int):
        self.process = process
        self.worker_id = worker_id
        self.started_at = time.time()
        self.pid = process.pid

    @property
    def is_alive(self) -> bool:
        return self.process.is_alive()

    @property
    def uptime(self) -> float:
        return time.time() - self.started_at


class Orchestrator:
    def __init__(self, config: dict):
        self.config = config
        self.workers: list[WorkerProcess] = []
        self._shutdown = False
        self._next_worker_id = 1

    def run(self):
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)

        init_db()

        from crate.utils import init_musicbrainz
        init_musicbrainz()

        # Clean up orphaned tasks from previous crash
        self._cleanup_orphaned_tasks()

        # Start filesystem watcher in main process
        watcher = self._start_watcher()

        # Start initial workers
        min_workers = self._get_min_workers()
        for _ in range(min_workers):
            self._spawn_worker()

        log.info("Orchestrator started with %d workers (min=%d, max=%d)",
                 len(self.workers), min_workers, self._get_max_workers())

        last_schedule_check = 0
        last_scale_check = 0
        last_health_check = 0
        last_cleanup = 0
        last_import_check = 0
        last_status_update = 0

        while not self._shutdown:
            now = time.time()

            # Check scheduled tasks every 60s
            if now - last_schedule_check > 60:
                last_schedule_check = now
                try:
                    from crate.scheduler import check_and_create_scheduled_tasks
                    check_and_create_scheduled_tasks()
                except Exception:
                    log.debug("Schedule check failed", exc_info=True)

            # Periodic import queue check every 60s
            if now - last_import_check > 60:
                last_import_check = now
                try:
                    from crate.importer import ImportQueue
                    queue = ImportQueue(load_config())
                    count = len(queue.refresh_pending_state())
                    set_cache("imports_pending", {"count": count})
                except Exception:
                    pass

            # Health check workers every 10s
            if now - last_health_check > HEALTH_CHECK_INTERVAL:
                last_health_check = now
                self._health_check()
                # Also clean zombie tasks (stuck in running >30min with no active worker)
                self._cleanup_zombie_tasks()

            # Autoscale every 30s
            if now - last_scale_check > SCALE_CHECK_INTERVAL:
                last_scale_check = now
                self._autoscale()

            # Update status cache every 15s
            if now - last_status_update > 15:
                last_status_update = now
                try:
                    set_cache("worker_status", self.get_status(), ttl=60)
                except Exception:
                    pass

            # Cleanup old tasks/events every hour
            if now - last_cleanup > 3600:
                last_cleanup = now
                self._periodic_cleanup()

            time.sleep(2)

        # Graceful shutdown
        log.info("Orchestrator shutting down...")
        if watcher:
            try:
                watcher.stop()
            except Exception:
                pass
        self._shutdown_workers()
        log.info("Orchestrator shut down")

    def _handle_signal(self, signum, frame):
        self._shutdown = True

    def _spawn_worker(self) -> WorkerProcess:
        worker_id = self._next_worker_id
        self._next_worker_id += 1

        p = multiprocessing.Process(
            target=_worker_process_entry,
            args=(self.config, worker_id, MAX_TASKS_BEFORE_RECYCLE, MAX_RSS_MB),
            daemon=True,
            name=f"worker-{worker_id}",
        )
        p.start()
        wp = WorkerProcess(p, worker_id)
        wp.pid = p.pid
        self.workers.append(wp)
        log.info("Spawned worker-%d (PID %s)", worker_id, p.pid)
        return wp

    def _health_check(self):
        """Check worker processes, restart dead ones."""
        alive = []
        for wp in self.workers:
            if wp.is_alive:
                alive.append(wp)
            else:
                exit_code = wp.process.exitcode
                log.warning("Worker-%d (PID %s) died with exit code %s",
                            wp.worker_id, wp.pid, exit_code)
                wp.process.join(timeout=1)

        self.workers = alive

        min_workers = self._get_min_workers()
        while len(self.workers) < min_workers and not self._shutdown:
            self._spawn_worker()

    def _autoscale(self):
        """Scale workers based on queue depth."""
        min_w = self._get_min_workers()
        max_w = self._get_max_workers()
        current = len(self.workers)

        try:
            pending = list_tasks(status="pending", limit=100)
            running = list_tasks(status="running", limit=100)
            pending_count = len(pending)
            running_count = len(running)
        except Exception:
            return

        # Scale up: if pending tasks > current workers and below max
        if pending_count > current and current < max_w:
            target = min(current + 1, max_w)
            for _ in range(target - current):
                self._spawn_worker()
            log.info("Scaled up to %d workers (pending=%d)", len(self.workers), pending_count)

    def _shutdown_workers(self):
        """Gracefully stop all workers."""
        for wp in self.workers:
            if wp.is_alive:
                try:
                    os.kill(wp.process.pid, signal.SIGTERM)
                except (OSError, ProcessLookupError):
                    pass

        # Wait up to 30s for graceful exit
        deadline = time.time() + 30
        for wp in self.workers:
            remaining = max(0, deadline - time.time())
            wp.process.join(timeout=remaining)
            if wp.is_alive:
                log.warning("Force-killing worker-%d", wp.worker_id)
                wp.process.kill()

    def _cleanup_orphaned_tasks(self):
        """Mark tasks stuck in 'running' as failed."""
        try:
            orphaned = list_tasks(status="running")
            for t in orphaned:
                log.warning("Marking orphaned task %s (type=%s) as failed", t["id"], t["type"])
                update_task(t["id"], status="failed", error="Orphaned: orchestrator restarted")
        except Exception:
            log.warning("Failed to clean orphaned tasks", exc_info=True)

    def _start_watcher(self):
        try:
            from crate.library_sync import LibrarySync
            from crate.library_watcher import LibraryWatcher
            sync = LibrarySync(self.config)
            watcher = LibraryWatcher(self.config, sync)
            watcher.start()
            log.info("Filesystem watcher started")
            return watcher
        except Exception:
            log.warning("Library watcher failed to start", exc_info=True)
            return None

    def _periodic_cleanup(self):
        try:
            from crate.db.events import cleanup_old_events, cleanup_old_tasks
            cleanup_old_events(max_age_hours=48)
            cleanup_old_tasks(max_age_days=7)
        except Exception:
            log.debug("Auto-cleanup failed")

    def _cleanup_zombie_tasks(self):
        """Mark tasks stuck in 'running' for >30min as failed.
        Workers that die (OOM, crash) leave tasks in running state."""
        try:
            running = list_tasks(status="running")
            now_ts = time.time()
            for t in running:
                try:
                    from datetime import datetime, timezone
                    from crate.utils import to_datetime
                    updated = to_datetime(t["updated_at"])
                    if updated is None:
                        continue
                    age_sec = (datetime.now(timezone.utc) - updated).total_seconds()
                    if age_sec > 1800:  # 30 minutes
                        log.warning("Marking zombie task %s (type=%s, age=%dm) as failed",
                                   t["id"], t["type"], int(age_sec / 60))
                        update_task(t["id"], status="failed", error="Zombie: no heartbeat for >30min")
                except Exception:
                    pass
        except Exception:
            pass

    def _get_min_workers(self) -> int:
        return int(get_setting("min_workers", str(DEFAULT_MIN_WORKERS)) or DEFAULT_MIN_WORKERS)

    def _get_max_workers(self) -> int:
        return int(get_setting("max_workers", str(DEFAULT_MAX_WORKERS)) or DEFAULT_MAX_WORKERS)

    def get_status(self) -> dict:
        """Get orchestrator status for API."""
        return {
            "workers": [
                {
                    "id": wp.worker_id,
                    "pid": wp.pid,
                    "alive": wp.is_alive,
                    "uptime_seconds": round(wp.uptime),
                }
                for wp in self.workers
            ],
            "min_workers": self._get_min_workers(),
            "max_workers": self._get_max_workers(),
            "total_workers": len(self.workers),
            "alive_workers": sum(1 for w in self.workers if w.is_alive),
        }


def _worker_process_entry(config: dict, worker_id: int, max_tasks: int, max_rss_mb: int):
    """Entry point for a child worker process. Runs until recycle conditions met."""
    import resource

    logging.basicConfig(
        level=logging.INFO,
        format=f"%(asctime)s [%(levelname)s] worker-{worker_id}: %(message)s",
    )
    wlog = logging.getLogger(f"worker-{worker_id}")

    # Each process needs its own DB pool (don't call init_db — orchestrator does that)
    from crate.db.core import _reset_pool
    _reset_pool()

    from crate.utils import init_musicbrainz
    init_musicbrainz()

    shutdown = False

    def handle_signal(signum, frame):
        nonlocal shutdown
        shutdown = True

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    tasks_completed = 0

    wlog.info("Started (PID %d, max_tasks=%d, max_rss=%dMB)", os.getpid(), max_tasks, max_rss_mb)

    from crate.worker import TASK_HANDLERS, _is_cancelled

    while not shutdown:
        # Check recycle conditions
        if tasks_completed >= max_tasks:
            wlog.info("Recycling after %d tasks", tasks_completed)
            break

        rss_bytes = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        if os.uname().sysname == "Darwin":
            rss_mb = rss_bytes / (1024 * 1024)  # macOS reports bytes
        else:
            rss_mb = rss_bytes / 1024  # Linux reports KB
        if rss_mb > max_rss_mb:
            wlog.info("Recycling due to memory: %d MB > %d MB", int(rss_mb), max_rss_mb)
            break

        # Claim a task
        max_running = int(get_setting("max_workers", "5") or 5)
        worker_db_id = f"orchestrator:{os.getpid()}:{worker_id}"
        task = claim_next_task(max_running=max_running, worker_id=worker_db_id)
        if not task:
            time.sleep(2)
            continue

        task_id = task["id"]
        task_type = task["type"]
        params = task.get("params", {})

        wlog.info("Processing task %s (type=%s)", task_id, task_type)
        hb_stop = threading.Event()
        hb_thread = threading.Thread(target=_heartbeat_until_stopped, args=(task_id, hb_stop), daemon=True)
        hb_thread.start()

        try:
            handler = TASK_HANDLERS.get(task_type)
            if not handler:
                update_task(task_id, status="failed", error=f"Unknown task type: {task_type}")
                continue

            result = handler(task_id, params, config)
            if _is_cancelled(task_id):
                wlog.info("Task %s was cancelled", task_id)
            elif isinstance(result, dict) and result.get("error"):
                error = str(result.get("error") or "Task failed")[:500]
                update_task(task_id, status="failed", result=result, error=error)
                _try_fan_in_parent(task, task_type, task_id)
                wlog.warning("Task %s failed: %s", task_id, error)
            else:
                update_task(task_id, status="completed", result=result or {})
                _try_fan_in_parent(task, task_type, task_id)
                wlog.info("Task %s completed", task_id)
            tasks_completed += 1

        except Exception as e:
            wlog.exception("Task %s failed", task_id)
            try:
                terminal_status = fail_or_retry_task(task_id, str(e)[:500])
                if terminal_status == "failed":
                    _try_fan_in_parent(task, task_type, task_id)
            except Exception:
                wlog.error("Could not mark task %s as failed", task_id)
        finally:
            hb_stop.set()
            hb_thread.join(timeout=2)

    wlog.info("Exiting after %d tasks", tasks_completed)


def _heartbeat_until_stopped(task_id: str, stop_event: threading.Event) -> None:
    while not stop_event.wait(15):
        try:
            heartbeat_task(task_id)
        except Exception:
            pass


def _try_fan_in_parent(task: dict, task_type: str, task_id: str) -> None:
    parent_id = task.get("parent_task_id")
    if not parent_id:
        return
    try:
        from crate.worker_handlers.analysis import _try_complete_parent
        _try_complete_parent(parent_id, task_type)
    except Exception:
        log.warning("Fan-in check failed for parent %s after child %s", parent_id, task_id, exc_info=True)
