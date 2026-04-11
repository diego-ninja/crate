"""Dramatiq actors — thin wrappers around existing task handlers.

Each actor:
1. Reads the PG task row (created by dispatch_task)
2. Updates status to 'running' + starts heartbeat thread
3. Calls the existing handler function
4. Updates status to 'completed' or 'failed'
5. Checks memory and exits if RSS > limit (dramatiq restarts the process)

Actors are registered dynamically from TASK_POOL_CONFIG to avoid 44 copy-paste blocks.
"""

import logging
import os
import resource
import signal
import threading
import time
from datetime import datetime, timezone

import dramatiq

# Broker must be imported before actor registration
import crate.broker  # noqa: F401

log = logging.getLogger(__name__)

MAX_RSS_MB = 1500  # 1.5 GB — matches previous worker recycling limit

# ── Pool configuration ────────────────────────────────────────────
# task_type → (queue, priority, time_limit_sec, max_retries)
#
# Queues:
#   fast    — I/O-bound: HTTP APIs, light DB
#   heavy   — CPU-bound: audio analysis, bliss vectors
#   default — mixed: sync, pipeline, downloads, management

TASK_POOL_CONFIG: dict[str, tuple[str, int, int, int]] = {
    # User-initiated (priority 0) — these should run ASAP
    "tidal_download":       ("default", 0, 1800, 0),
    "soulseek_download":    ("default", 0, 1800, 2),
    "delete_artist":        ("default", 0, 300, 0),
    "delete_album":         ("default", 0, 300, 0),
    "move_artist":          ("default", 0, 600, 0),
    "update_album_tags":    ("default", 0, 300, 0),
    "update_track_tags":    ("default", 0, 120, 0),
    "match_apply":          ("default", 0, 300, 0),
    "fetch_cover":          ("fast",    0, 120, 2),
    "apply_cover":          ("fast",    0, 60, 0),
    "upload_image":         ("default", 0, 60, 0),
    "library_upload":       ("default", 0, 7200, 1),
    "reset_enrichment":     ("fast",    1, 120, 0),
    "refresh_user_listening_stats": ("fast", 1, 300, 0),

    # New content processing (priority 1)
    "process_new_content":  ("default", 1, 14400, 0),
    "enrich_artist":        ("fast",    1, 180, 2),
    "analyze_album_full":   ("fast",    1, 60, 0),  # just resets state for background daemon

    # Scheduled recurring (priority 2)
    "library_sync":         ("default", 2, 3600, 0),
    "library_pipeline":     ("default", 2, 7200, 0),
    "health_check":         ("default", 2, 1500, 0),
    "repair":               ("default", 2, 3600, 0),
    "compute_analytics":    ("fast",    2, 600, 0),
    "check_new_releases":   ("fast",    2, 600, 1),
    "scan":                 ("default", 2, 1800, 0),
    "fix_issues":           ("default", 2, 3600, 0),
    "fetch_artist_covers":  ("fast",    2, 300, 1),
    "batch_retag":          ("default", 2, 3600, 0),
    "batch_covers":         ("fast",    2, 3600, 0),
    "wipe_library":         ("default", 2, 300, 0),
    "rebuild_library":      ("default", 2, 14400, 0),
    "resolve_duplicates":   ("default", 2, 600, 0),

    # Background batch (priority 3)
    "enrich_artists":       ("fast",    3, 86400, 0),
    "enrich_mbids":         ("fast",    3, 86400, 0),
    "compute_popularity":   ("fast",    3, 3600, 0),
    "compute_bliss":        ("fast",    3, 60, 0),   # just resets state for background daemon
    "analyze_tracks":       ("fast",    2, 60, 0),   # just resets state for background daemon
    "analyze_all":          ("fast",    3, 60, 0),    # just resets state for background daemon
    "index_genres":         ("fast",    3, 600, 0),
    "scan_missing_covers":  ("fast",    3, 3600, 0),
    "fetch_artwork_all":    ("fast",    3, 3600, 0),
    "backfill_similarities": ("fast",   3, 3600, 0),
    "sync_shows":           ("fast",    3, 600, 1),
    "cleanup_incomplete_downloads": ("default", 3, 600, 0),
}

# DB-heavy tasks — only one at a time via Redis mutex
DB_HEAVY_TASK_TYPES = frozenset({
    "library_sync", "library_pipeline", "wipe_library",
    "rebuild_library", "repair", "enrich_mbids",
})


# ── Heartbeat ─────────────────────────────────────────────────────

def _heartbeat_loop(task_id: str, stop_event: threading.Event):
    """Background thread: updates heartbeat_at every 30s while task runs."""
    from crate.db.tasks import heartbeat_task
    while not stop_event.wait(30):
        try:
            heartbeat_task(task_id)
        except Exception:
            pass


# ── Memory recycling ──────────────────────────────────────────────

def _check_memory():
    """Exit if RSS exceeds limit. Dramatiq will restart the process."""
    rss_bytes = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if os.uname().sysname == "Darwin":
        rss_mb = rss_bytes / (1024 * 1024)
    else:
        rss_mb = rss_bytes / 1024
    if rss_mb > MAX_RSS_MB:
        log.warning("Recycling: RSS=%dMB > %dMB limit", int(rss_mb), MAX_RSS_MB)
        # SIGTERM ourselves — dramatiq handles graceful restart
        os.kill(os.getpid(), signal.SIGUSR1)


# ── DB-heavy mutex ────────────────────────────────────────────────

_db_heavy_lock = threading.Lock()  # in-process lock
_DB_HEAVY_REDIS_KEY = "crate:db_heavy_lock"
_DB_HEAVY_LOCK_TTL = 7200  # 2h max


def clear_db_heavy_lock():
    """Force-clear the DB-heavy lock. Called on worker startup."""
    try:
        from crate.db.cache import _get_redis
        r = _get_redis()
        if r:
            r.delete(_DB_HEAVY_REDIS_KEY)
    except Exception:
        pass


def _acquire_db_heavy_lock(task_id: str, timeout: int = 60) -> bool:
    """Acquire a Redis-based mutex for DB-heavy tasks. Blocks up to timeout seconds."""
    try:
        from crate.db.cache import _get_redis
        r = _get_redis()
        if not r:
            log.warning("Redis unavailable — DB-heavy lock cannot be acquired, proceeding without lock")
            return True  # no Redis → proceed with warning
        deadline = time.time() + timeout
        while time.time() < deadline:
            if r.set(_DB_HEAVY_REDIS_KEY, task_id, nx=True, ex=_DB_HEAVY_LOCK_TTL):
                return True
            time.sleep(5)
        return False
    except Exception:
        log.warning("Failed to acquire DB-heavy lock, proceeding without lock", exc_info=True)
        return True


def _release_db_heavy_lock(task_id: str):
    """Release the DB-heavy mutex. Uses Lua script for atomic check-and-delete."""
    try:
        from crate.db.cache import _get_redis
        r = _get_redis()
        if r:
            # Atomic: only delete if we hold the lock
            r.eval(
                "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
                1, _DB_HEAVY_REDIS_KEY, task_id,
            )
            log.debug("Released DB-heavy lock for task %s", task_id)
    except Exception:
        log.warning("Failed to release DB-heavy lock for task %s", task_id, exc_info=True)


# ── Generic task executor ─────────────────────────────────────────

def _execute_task(task_type: str, task_id: str):
    """Generic wrapper: read PG task → run handler → update PG → check memory."""
    from crate.config import load_config
    from crate.db.tasks import get_task, update_task
    from crate.worker import TASK_HANDLERS, _is_cancelled

    task = get_task(task_id)
    if not task:
        log.warning("Task %s not found in DB, skipping", task_id)
        return
    if task.get("status") == "cancelled":
        log.info("Task %s already cancelled, skipping", task_id)
        return

    handler = TASK_HANDLERS.get(task_type)
    if not handler:
        update_task(task_id, status="failed", error=f"Unknown task type: {task_type}")
        return

    # DB-heavy mutex — check BEFORE marking as running
    is_db_heavy = task_type in DB_HEAVY_TASK_TYPES
    if is_db_heavy:
        if not _acquire_db_heavy_lock(task_id):
            log.info("Task %s (%s) waiting for DB-heavy lock, re-enqueueing in 30s", task_id, task_type)
            # Re-send with a 30s delay (task stays pending in PG)
            actor = _actors.get(task_type)
            if actor:
                actor.send_with_options(args=(task_id,), delay=30_000)
            return

    # Mark running + start heartbeat
    update_task(task_id, status="running")
    hb_stop = threading.Event()
    hb_thread = threading.Thread(target=_heartbeat_loop, args=(task_id, hb_stop), daemon=True)
    hb_thread.start()

    try:
        config = load_config()
        result = handler(task_id, task.get("params", {}), config)

        if _is_cancelled(task_id):
            log.info("Task %s was cancelled during execution", task_id)
        else:
            update_task(task_id, status="completed", result=result or {})
            log.info("Task %s (%s) completed", task_id, task_type)

    except Exception as e:
        log.exception("Task %s (%s) failed", task_id, task_type)
        try:
            update_task(task_id, status="failed", error=str(e)[:500])
        except Exception:
            log.error("Could not mark task %s as failed", task_id)
        raise  # let dramatiq handle retry logic

    finally:
        hb_stop.set()
        hb_thread.join(timeout=2)
        if is_db_heavy:
            _release_db_heavy_lock(task_id)
        _check_memory()


# ── Dynamic actor registration ────────────────────────────────────
# Creates one dramatiq.actor per task type from TASK_POOL_CONFIG.

_actors: dict[str, dramatiq.Actor] = {}


def _make_actor_fn(task_type: str):
    """Create a closure that calls _execute_task for a specific task type."""
    def actor_fn(task_id: str):
        _execute_task(task_type, task_id)
    actor_fn.__name__ = task_type
    actor_fn.__qualname__ = task_type
    return actor_fn


def _register_actors():
    """Register all task types as dramatiq actors."""
    for task_type, (queue, _priority, timeout_sec, max_retries) in TASK_POOL_CONFIG.items():
        fn = _make_actor_fn(task_type)
        actor = dramatiq.actor(
            fn,
            actor_name=task_type,
            queue_name=queue,
            max_retries=max_retries,
            time_limit=timeout_sec * 1000,
            min_backoff=5_000,
            max_backoff=60_000,
        )
        _actors[task_type] = actor


_register_actors()


def get_actor(task_type: str) -> dramatiq.Actor | None:
    """Get the dramatiq actor for a task type."""
    return _actors.get(task_type)


def dispatch_to_dramatiq(task_type: str, task_id: str):
    """Send a task to Dramatiq for execution."""
    actor = _actors.get(task_type)
    if actor:
        actor.send(task_id)
    else:
        log.warning("No dramatiq actor for task type: %s (task %s)", task_type, task_id)


def get_queue_for_task(task_type: str) -> str:
    """Get the queue name for a task type."""
    config = TASK_POOL_CONFIG.get(task_type)
    return config[0] if config else "default"


def get_priority_for_task(task_type: str) -> int:
    """Get the default priority for a task type."""
    config = TASK_POOL_CONFIG.get(task_type)
    return config[1] if config else 2
