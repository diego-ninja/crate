from __future__ import annotations

import logging
import os
import time

from crate.db.cache_runtime import _get_redis
from crate.db.cache_settings import get_setting
from crate.db.events import emit_task_event
from crate.db.repositories.streaming import mark_variant_running
from crate.streaming.transcode import transcode_variant
from crate.task_progress import TaskProgress, emit_progress
from crate.worker_handlers import TaskHandler

log = logging.getLogger(__name__)

_TRANSCODE_SLOT_KEY = "crate:stream_transcode_slots"
_TRANSCODE_SLOT_TTL_SECONDS = 1200
_TRANSCODE_SLOT_WAIT_SECONDS = 600


def _max_concurrent_transcodes(config: dict) -> int:
    raw = config.get("stream_transcode_max_concurrent", 1)
    raw = os.environ.get("CRATE_STREAM_TRANSCODE_MAX_CONCURRENT", raw)
    try:
        raw = get_setting("stream_transcode_max_concurrent", str(raw))
    except Exception:
        pass
    try:
        return max(1, min(int(raw), 4))
    except (TypeError, ValueError):
        return 1


def prune_stream_transcode_slots() -> None:
    redis = _get_redis()
    if redis is None:
        return
    try:
        redis.zremrangebyscore(_TRANSCODE_SLOT_KEY, 0, time.time() - _TRANSCODE_SLOT_TTL_SECONDS)
    except Exception:
        log.debug("Failed to prune stream transcode slots", exc_info=True)


def get_stream_transcode_runtime(config: dict | None = None) -> dict:
    redis = _get_redis()
    active = 0
    slots: list[dict] = []
    now = time.time()
    if redis is not None:
        try:
            redis.zremrangebyscore(_TRANSCODE_SLOT_KEY, 0, now - _TRANSCODE_SLOT_TTL_SECONDS)
            active = int(redis.zcard(_TRANSCODE_SLOT_KEY) or 0)
            slots = [
                {
                    "task_id": task_id.decode("utf-8", "replace") if isinstance(task_id, bytes) else str(task_id),
                    "started_at": float(started_at),
                }
                for task_id, started_at in redis.zrange(_TRANSCODE_SLOT_KEY, 0, -1, withscores=True)
            ]
        except Exception:
            log.debug("Failed to read stream transcode runtime", exc_info=True)
    return {
        "limit": _max_concurrent_transcodes(config or {}),
        "active": active,
        "slots": slots,
    }


def _acquire_slot(task_id: str, limit: int) -> bool:
    redis = _get_redis()
    if redis is None:
        return True

    acquire_script = """
    local key = KEYS[1]
    local task_id = ARGV[1]
    local now = tonumber(ARGV[2])
    local ttl = tonumber(ARGV[3])
    local limit = tonumber(ARGV[4])
    redis.call('ZREMRANGEBYSCORE', key, 0, now - ttl)
    if redis.call('ZSCORE', key, task_id) then
        redis.call('ZADD', key, now, task_id)
        redis.call('EXPIRE', key, ttl)
        return 1
    end
    if redis.call('ZCARD', key) < limit then
        redis.call('ZADD', key, now, task_id)
        redis.call('EXPIRE', key, ttl)
        return 1
    end
    return 0
    """
    deadline = time.time() + _TRANSCODE_SLOT_WAIT_SECONDS
    while time.time() < deadline:
        now = time.time()
        try:
            acquired = redis.eval(
                acquire_script,
                1,
                _TRANSCODE_SLOT_KEY,
                task_id,
                str(now),
                str(_TRANSCODE_SLOT_TTL_SECONDS),
                str(limit),
            )
            if int(acquired or 0) == 1:
                return True
        except Exception:
            log.debug("Failed to acquire stream transcode slot", exc_info=True)
            return True
        time.sleep(2)
    return False


def _release_slot(task_id: str) -> None:
    redis = _get_redis()
    if redis is None:
        return
    try:
        redis.zrem(_TRANSCODE_SLOT_KEY, task_id)
    except Exception:
        log.debug("Failed to release stream transcode slot", exc_info=True)


def _handle_prepare_stream_variant(task_id: str, params: dict, config: dict) -> dict:
    cache_key = str(params.get("cache_key") or "").strip()
    if not cache_key:
        raise ValueError("cache_key is required")

    progress = TaskProgress(phase="waiting", total=1, done=0, item=cache_key[:12])
    emit_progress(task_id, progress)
    emit_task_event(task_id, "info", {"message": "Preparing playback variant", "cache_key": cache_key})

    limit = _max_concurrent_transcodes(config)
    if not _acquire_slot(task_id, limit):
        raise RuntimeError("Timed out waiting for stream transcode slot")

    try:
        progress.phase = "transcoding"
        emit_progress(task_id, progress)
        mark_variant_running(cache_key, task_id)
        transcode_started = time.monotonic()
        try:
            row = transcode_variant(cache_key)
            elapsed = time.monotonic() - transcode_started
            try:
                from crate.metrics import record

                preset = str(row.get("preset") or params.get("preset") or "unknown")
                record("stream.transcode.duration", elapsed, {"preset": preset, "status": "completed"})
                record("stream.transcode.completed", 1, {"preset": preset})
                if row.get("bytes"):
                    record("stream.transcode.bytes", float(row["bytes"]), {"preset": preset})
            except Exception:
                pass
        except Exception:
            elapsed = time.monotonic() - transcode_started
            try:
                from crate.metrics import record

                record("stream.transcode.duration", elapsed, {"preset": "unknown", "status": "failed"})
                record("stream.transcode.failed", 1, {"preset": "unknown"})
            except Exception:
                pass
            raise
        progress.phase = "complete"
        progress.done = 1
        emit_progress(task_id, progress)
        return {
            "cache_key": cache_key,
            "variant_id": row.get("id"),
            "bytes": row.get("bytes"),
            "relative_path": row.get("relative_path"),
        }
    finally:
        _release_slot(task_id)


PLAYBACK_TASK_HANDLERS: dict[str, TaskHandler] = {
    "prepare_stream_variant": _handle_prepare_stream_variant,
}
