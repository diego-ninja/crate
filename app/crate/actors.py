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
    "tidal_download":       ("default", 0, 14400, 0),   # 4h — artist discographies in FLAC are huge
    "soulseek_download":    ("default", 0, 7200, 2),    # 2h — soulseek transfers are slow
    "delete_artist":        ("default", 0, 300, 0),
    "delete_album":         ("default", 0, 300, 0),
    "move_artist":          ("default", 0, 600, 0),
    "update_album_tags":    ("default", 0, 300, 0),
    "update_track_tags":    ("default", 0, 120, 0),
    "match_apply":          ("default", 0, 300, 0),
    "fetch_cover":          ("fast",    0, 120, 2),
    "apply_cover":          ("fast",    0, 60, 0),
    "fetch_album_cover":    ("fast",    0, 120, 1),
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
    "infer_genre_taxonomy": ("fast",    3, 3600, 0),
    "enrich_genre_descriptions": ("fast", 3, 3600, 0),
    "sync_musicbrainz_genre_graph": ("fast", 3, 5400, 0),
    "cleanup_invalid_genre_taxonomy": ("fast", 3, 900, 0),
    "remux_m4a_dash":       ("fast",    3, 7200, 0),
    "scan_missing_covers":  ("fast",    3, 3600, 0),
    "fetch_artwork_all":    ("fast",    3, 3600, 0),
    "backfill_similarities": ("fast",   3, 3600, 0),
    "sync_shows":           ("fast",    3, 600, 1),
    "sync_shows_lastfm":    ("fast",    3, 3600, 0),
    "cleanup_incomplete_downloads": ("default", 3, 600, 0),

    # Storage migration (priority 1 — user-initiated, long-running)
    "migrate_storage_v2":   ("default", 1, 14400, 0),
    "verify_storage_v2":    ("default", 2, 3600, 0),

    # Library completeness check
    "compute_completeness": ("fast",    3, 3600, 0),

    # Playlist generation
    "generate_system_playlist":         ("fast", 1, 600, 0),
    "refresh_system_smart_playlists":   ("fast", 3, 1800, 0),
    "persist_playlist_cover":           ("fast", 0, 120, 1),
}

# DB-heavy tasks — only one at a time via Redis mutex
DB_HEAVY_TASK_TYPES = frozenset({
    "library_sync", "library_pipeline", "wipe_library",
    "rebuild_library", "repair", "enrich_mbids",
    "migrate_storage_v2",
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


# ── Download concurrency limiter ──────────────────────────────────
# Tidal/Soulseek downloads are I/O-heavy and Tidal rate-limits
# aggressively.  Allow at most 2 concurrent downloads across all
# workers via a Redis-based counting semaphore.

DOWNLOAD_TASK_TYPES = frozenset({"tidal_download", "soulseek_download"})


def _is_in_download_window() -> bool:
    """Check if current time is within the configured download window.
    Returns True (allow download) if window is disabled or we're inside it."""
    from crate.db.cache import get_setting
    if get_setting("download_window_enabled", "false") != "true":
        return True  # Window disabled, always allow
    start_str = get_setting("download_window_start", "02:00")
    end_str = get_setting("download_window_end", "07:00")
    try:
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        hour, minute = map(int, start_str.split(":"))
        start_minutes = hour * 60 + minute
        hour, minute = map(int, end_str.split(":"))
        end_minutes = hour * 60 + minute
        current_minutes = now.hour * 60 + now.minute
        if start_minutes <= end_minutes:
            return start_minutes <= current_minutes < end_minutes
        else:
            return current_minutes >= start_minutes or current_minutes < end_minutes
    except Exception:
        return True  # On error, allow


def _ms_until_download_window() -> int:
    """Milliseconds until the next download window opens."""
    from crate.db.cache import get_setting
    start_str = get_setting("download_window_start", "02:00")
    try:
        from datetime import datetime, timezone, timedelta
        now = datetime.now(timezone.utc)
        hour, minute = map(int, start_str.split(":"))
        target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if target <= now:
            target += timedelta(days=1)
        delta = target - now
        return int(delta.total_seconds() * 1000)
    except Exception:
        return 3600_000  # fallback: 1 hour
_DOWNLOAD_SEM_KEY = "crate:download_semaphore"
_DOWNLOAD_SEM_MAX = 2
_DOWNLOAD_SEM_TTL = 14400  # 4h — matches tidal_download timeout


def _acquire_download_slot(task_id: str, timeout: int = 120) -> bool:
    try:
        from crate.db.cache import _get_redis
        r = _get_redis()
        if not r:
            return True
        deadline = time.time() + timeout
        while time.time() < deadline:
            current = r.scard(_DOWNLOAD_SEM_KEY)
            if current < _DOWNLOAD_SEM_MAX:
                r.sadd(_DOWNLOAD_SEM_KEY, task_id)
                r.expire(_DOWNLOAD_SEM_KEY, _DOWNLOAD_SEM_TTL)
                return True
            time.sleep(10)
        return False
    except Exception:
        log.warning("Failed to acquire download slot, proceeding", exc_info=True)
        return True


def _release_download_slot(task_id: str):
    try:
        from crate.db.cache import _get_redis
        r = _get_redis()
        if r:
            r.srem(_DOWNLOAD_SEM_KEY, task_id)
    except Exception:
        log.warning("Failed to release download slot for %s", task_id, exc_info=True)


def clear_download_slots():
    """Force-clear download semaphore. Called on worker startup."""
    try:
        from crate.db.cache import _get_redis
        r = _get_redis()
        if r:
            r.delete(_DOWNLOAD_SEM_KEY)
    except Exception:
        pass


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
            actor = _actors.get(task_type)
            if actor:
                actor.send_with_options(args=(task_id,), delay=30_000)
            return

    # Download window enforcement
    is_download = task_type in DOWNLOAD_TASK_TYPES
    if is_download and not _is_in_download_window():
        delay_ms = _ms_until_download_window()
        log.info("Task %s (%s) outside download window, deferring %dmin", task_id, task_type, delay_ms // 60000)
        update_task(task_id, progress="Scheduled for download window")
        actor = _actors.get(task_type)
        if actor:
            actor.send_with_options(args=(task_id,), delay=min(delay_ms, 3600_000))
        return

    # Download concurrency limiter
    if is_download:
        if not _acquire_download_slot(task_id):
            log.info("Task %s (%s) waiting for download slot, re-enqueueing in 30s", task_id, task_type)
            actor = _actors.get(task_type)
            if actor:
                actor.send_with_options(args=(task_id,), delay=30_000)
            return

    # Mark running + start heartbeat
    import time as _time
    _task_start = _time.monotonic()

    update_task(task_id, status="running")
    hb_stop = threading.Event()
    hb_thread = threading.Thread(target=_heartbeat_loop, args=(task_id, hb_stop), daemon=True)
    hb_thread.start()

    # Record queue wait time (created → running)
    try:
        from crate.metrics import record
        created = task.get("created_at")
        if created and hasattr(created, "timestamp"):
            wait_sec = _time.time() - created.timestamp()
            record("worker.queue.wait", wait_sec, {"type": task_type})
    except Exception:
        pass

    try:
        config = load_config()
        result = handler(task_id, task.get("params", {}), config)

        if _is_cancelled(task_id):
            log.info("Task %s was cancelled during execution", task_id)
        else:
            update_task(task_id, status="completed", result=result or {})
            log.info("Task %s (%s) completed", task_id, task_type)
            try:
                from crate.metrics import record as _record
                _record("worker.task.duration", _time.monotonic() - _task_start, {"type": task_type, "status": "completed"})
            except Exception:
                pass
            try:
                from crate.telegram import notify_task_completed
                notify_task_completed(task_type, task_id, result)
            except Exception:
                pass
            try:
                from crate.db.events import _publish_to_redis
                _publish_to_redis(task_id, "task_done", {"type": "task_done", "status": "completed", "task_type": task_type}, "")
            except Exception:
                pass

    except Exception as e:
        log.exception("Task %s (%s) failed", task_id, task_type)
        try:
            from crate.metrics import record as _record
            _record("worker.task.duration", _time.monotonic() - _task_start, {"type": task_type, "status": "failed"})
        except Exception:
            pass
        try:
            update_task(task_id, status="failed", error=str(e)[:500])
        except Exception:
            log.error("Could not mark task %s as failed", task_id)
        try:
            from crate.telegram import notify_task_failed
            notify_task_failed(task_type, task_id, str(e)[:300])
        except Exception:
            pass
        try:
            from crate.db.events import _publish_to_redis
            _publish_to_redis(task_id, "task_done", {"type": "task_done", "status": "failed", "task_type": task_type, "error": str(e)[:200]}, "")
        except Exception:
            pass
        raise  # let dramatiq handle retry logic

    finally:
        hb_stop.set()
        hb_thread.join(timeout=2)
        if is_db_heavy:
            _release_db_heavy_lock(task_id)
        if is_download:
            _release_download_slot(task_id)
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
