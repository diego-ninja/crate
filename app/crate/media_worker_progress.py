from __future__ import annotations

import json
import logging
import os
import socket
from typing import Any

from crate.db.cache_runtime import _get_redis

log = logging.getLogger(__name__)

DEFAULT_EVENTS_STREAM = "crate:media-worker:events"
DEFAULT_JOB_PREFIX = "crate:media-worker:job"
DEFAULT_CANCEL_PREFIX = "crate:media-worker:cancel"
DEFAULT_SLOT_PREFIX = "crate:media-worker:slot"
DEFAULT_CONSUMER_GROUP = "crate-media-worker-task-bridge"
DEFAULT_CANCEL_TTL_SECONDS = 86_400
DEFAULT_SLOT_TTL_SECONDS = 1_200
DEFAULT_MAX_ACTIVE = 1

_group_created = False


def media_worker_events_stream() -> str:
    return os.environ.get("CRATE_MEDIA_WORKER_EVENTS_STREAM", DEFAULT_EVENTS_STREAM)


def media_worker_job_key(job_id: str) -> str:
    prefix = os.environ.get("CRATE_MEDIA_WORKER_JOB_PREFIX", DEFAULT_JOB_PREFIX)
    return f"{prefix}:{job_id}"


def media_worker_cancel_key(job_id: str) -> str:
    prefix = os.environ.get("CRATE_MEDIA_WORKER_CANCEL_PREFIX", DEFAULT_CANCEL_PREFIX)
    return f"{prefix}:{job_id}"


def media_worker_slot_key(slot_index: int) -> str:
    prefix = os.environ.get("CRATE_MEDIA_WORKER_SLOT_PREFIX", DEFAULT_SLOT_PREFIX)
    return f"{prefix}:{slot_index}"


def media_worker_max_active() -> int:
    raw = os.environ.get("CRATE_MEDIA_WORKER_MAX_ACTIVE")
    try:
        return max(0, int(raw)) if raw is not None else DEFAULT_MAX_ACTIVE
    except ValueError:
        return DEFAULT_MAX_ACTIVE


class MediaWorkerSlotLease:
    def __init__(self, redis, key: str, job_id: str):
        self._redis = redis
        self.key = key
        self.job_id = job_id
        self.released = False

    def release(self) -> None:
        if self.released:
            return
        self.released = True
        try:
            if str(self._redis.get(self.key) or "") == self.job_id:
                self._redis.delete(self.key)
        except Exception:
            log.debug("Failed to release media-worker slot %s", self.key, exc_info=True)

    def __enter__(self) -> "MediaWorkerSlotLease":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.release()


class _NoMediaWorkerSlot:
    def __enter__(self):
        return None

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


def acquire_media_worker_slot(
    job_id: str,
    *,
    limit: int | None = None,
    ttl_seconds: int = DEFAULT_SLOT_TTL_SECONDS,
) -> MediaWorkerSlotLease | None:
    if not job_id:
        return None
    max_active = media_worker_max_active() if limit is None else max(0, int(limit))
    if max_active <= 0:
        return None
    redis = _get_redis()
    if not redis:
        return None
    ttl = max(1, int(ttl_seconds))
    for index in range(max_active):
        key = media_worker_slot_key(index)
        try:
            if redis.set(key, job_id, nx=True, ex=ttl):
                return MediaWorkerSlotLease(redis, key, job_id)
            if str(redis.get(key) or "") == job_id:
                redis.expire(key, ttl)
                return MediaWorkerSlotLease(redis, key, job_id)
        except Exception:
            log.debug("Failed to acquire media-worker slot %s", key, exc_info=True)
            return None
    return None


def media_worker_admission(
    job_id: str,
    *,
    limit: int | None = None,
    ttl_seconds: int = DEFAULT_SLOT_TTL_SECONDS,
):
    return acquire_media_worker_slot(job_id, limit=limit, ttl_seconds=ttl_seconds) or _NoMediaWorkerSlot()


def cancel_media_worker_job(job_id: str, *, ttl_seconds: int = DEFAULT_CANCEL_TTL_SECONDS) -> bool:
    if not job_id:
        return False
    redis = _get_redis()
    if not redis:
        return False
    try:
        redis.set(media_worker_cancel_key(job_id), "1", ex=max(1, int(ttl_seconds)))
        return True
    except Exception:
        log.debug("Failed to set media-worker cancel key for %s", job_id, exc_info=True)
        return False


def get_media_worker_job(job_id: str) -> dict[str, Any] | None:
    if not job_id:
        return None
    redis = _get_redis()
    if not redis:
        return None
    try:
        data = redis.hgetall(media_worker_job_key(job_id)) or {}
    except Exception:
        log.debug("Failed to read media-worker job %s", job_id, exc_info=True)
        return None
    if not data:
        return None
    payload = _decode_payload(data.get("payload_json"))
    result = dict(data)
    if payload:
        result["payload"] = payload
    return result


def get_media_worker_runtime(*, limit: int = 10) -> dict[str, Any]:
    stream = media_worker_events_stream()
    runtime: dict[str, Any] = {
        "redis_connected": False,
        "stream_key": stream,
        "consumer_group": os.environ.get("CRATE_MEDIA_WORKER_EVENTS_GROUP", DEFAULT_CONSUMER_GROUP),
        "stream_length": 0,
        "pending": 0,
        "max_active": media_worker_max_active(),
        "active_slots": [],
        "recent_events": [],
    }
    redis = _get_redis()
    if not redis:
        return runtime
    runtime["redis_connected"] = True
    try:
        runtime["stream_length"] = int(redis.xlen(stream) or 0)
    except Exception:
        pass
    try:
        groups = redis.xinfo_groups(stream) or []
        group = next((item for item in groups if item.get("name") == runtime["consumer_group"]), None)
        if group:
            runtime["pending"] = int(group.get("pending", 0) or 0)
    except Exception:
        pass
    try:
        for msg_id, fields in redis.xrevrange(stream, "+", "-", count=max(1, min(limit, 50))):
            runtime["recent_events"].append(_normalise_stream_event(msg_id, fields))
    except Exception:
        pass
    runtime["active_slots"] = _active_slots(redis)
    return runtime


def _active_slots(redis) -> list[dict[str, Any]]:
    slots: list[dict[str, Any]] = []
    for index in range(media_worker_max_active()):
        key = media_worker_slot_key(index)
        try:
            job_id = redis.get(key)
            if not job_id:
                continue
            ttl_ms = redis.pttl(key)
            slots.append({"slot": index, "key": key, "job_id": str(job_id), "ttl_ms": int(ttl_ms or 0)})
        except Exception:
            continue
    return slots


def bridge_media_worker_task_events(
    *,
    limit: int = 100,
    block_ms: int = 0,
    consumer_name: str | None = None,
) -> dict[str, int]:
    """Project media-worker Redis events onto Crate task events.

    The bridge only emits task events when the media-worker ``job_id`` matches
    an existing Crate task id. Download cache jobs use cache keys as job ids, so
    they remain visible through the media-worker stream/hash without polluting
    the task log.
    """

    redis = _get_redis()
    if not redis:
        return {"read": 0, "bridged": 0, "ignored": 0}
    stream = media_worker_events_stream()
    group = os.environ.get("CRATE_MEDIA_WORKER_EVENTS_GROUP", DEFAULT_CONSUMER_GROUP)
    if not _ensure_group(redis, stream, group):
        return {"read": 0, "bridged": 0, "ignored": 0}

    consumer = consumer_name or f"{socket.gethostname()}:{os.getpid()}"
    messages = _read_group(redis, stream, group, consumer, "0", limit=limit, block_ms=0)
    if not messages:
        messages = _read_group(redis, stream, group, consumer, ">", limit=limit, block_ms=block_ms)

    stats = {"read": 0, "bridged": 0, "ignored": 0}
    for msg_id, fields in messages:
        stats["read"] += 1
        try:
            if _bridge_one_event(msg_id, fields):
                stats["bridged"] += 1
            else:
                stats["ignored"] += 1
            redis.xack(stream, group, msg_id)
        except Exception:
            log.debug("Failed to bridge media-worker event %s", msg_id, exc_info=True)
    return stats


def _ensure_group(redis, stream: str, group: str) -> bool:
    global _group_created
    if _group_created:
        return True
    try:
        redis.xgroup_create(stream, group, id="0", mkstream=True)
        _group_created = True
        return True
    except Exception as exc:
        if "BUSYGROUP" in str(exc):
            _group_created = True
            return True
        log.debug("Could not create media-worker event consumer group", exc_info=True)
        return False


def _read_group(
    redis,
    stream: str,
    group: str,
    consumer: str,
    stream_id: str,
    *,
    limit: int,
    block_ms: int,
) -> list[tuple[str, dict[str, Any]]]:
    try:
        entries = redis.xreadgroup(
            group,
            consumer,
            {stream: stream_id},
            count=max(1, min(limit, 1000)),
            block=max(0, int(block_ms)),
        )
    except Exception:
        log.debug("Failed to read media-worker event stream", exc_info=True)
        return []
    messages: list[tuple[str, dict[str, Any]]] = []
    for _stream_name, stream_messages in entries or []:
        messages.extend(stream_messages)
    return messages


def _bridge_one_event(msg_id: str, fields: dict[str, Any]) -> bool:
    payload = _decode_payload(fields.get("payload_json"))
    job_id = str(payload.get("task_id") or payload.get("job_id") or fields.get("job_id") or "")
    if not job_id:
        return False

    from crate.db.queries.tasks import get_task

    task = get_task(job_id)
    if not task:
        return False

    event_name = str(payload.get("event") or fields.get("event") or "progress")
    progress = _task_progress(event_name, payload)
    if progress:
        from crate.db.repositories.tasks import update_task

        update_task(job_id, progress=json.dumps(progress, ensure_ascii=False, default=str))

    from crate.db.events import emit_task_event

    event_type = _task_event_type(event_name)
    emit_task_event(job_id, event_type, _task_event_payload(msg_id, event_name, payload))
    return True


def _normalise_stream_event(msg_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    payload = _decode_payload(fields.get("payload_json"))
    return {
        "id": msg_id,
        "job_id": payload.get("job_id") or fields.get("job_id"),
        "event": payload.get("event") or fields.get("event"),
        "status": payload.get("status") or fields.get("status"),
        "kind": payload.get("kind") or fields.get("kind"),
        "updated_at_ms": payload.get("ts_ms") or fields.get("ts_ms"),
        "payload": payload,
    }


def _decode_payload(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    try:
        value = json.loads(str(raw))
    except (json.JSONDecodeError, TypeError):
        return {}
    return value if isinstance(value, dict) else {}


def _task_progress(event_name: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    kind = str(payload.get("kind") or "media")
    total = _int_value(payload.get("total") or payload.get("total_entries"))
    index = _int_value(payload.get("index"))
    done = index if event_name in {"entry_finished", "finished"} else max(0, index - 1)
    if event_name == "finished":
        done = total or _int_value(payload.get("entries"))
    phase = {
        "started": f"{kind}_package",
        "copy_started": "copying",
        "copy_finished": "copying",
        "metadata_started": "embedding_metadata",
        "metadata_finished": "embedding_metadata",
        "entry_started": "writing_package",
        "entry_finished": "writing_package",
        "finished": "finished",
        "failed": "failed",
        "cancelled": "cancelled",
    }.get(event_name, "media_worker")
    return {
        "phase": phase,
        "item": str(payload.get("name") or payload.get("source_path") or payload.get("output_path") or ""),
        "done": done,
        "total": total,
        "percent": round((done / total) * 100, 1) if total > 0 else 0.0,
        "bytes": _int_value(payload.get("bytes")),
        "eta_sec": 0,
        "rate": 0.0,
    }


def _task_event_type(event_name: str) -> str:
    if event_name == "failed":
        return "error"
    if event_name == "cancelled":
        return "warn"
    if event_name == "finished":
        return "info"
    return "progress"


def _task_event_payload(msg_id: str, event_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    data = {
        "message": _message_for_event(event_name, payload),
        "media_worker_event": event_name,
        "media_worker_event_id": msg_id,
        "category": "media-worker",
    }
    for key in ("kind", "name", "index", "total", "bytes", "duration_ms", "output_path", "source_path", "errors"):
        if key in payload:
            data[key] = payload[key]
    return data


def _message_for_event(event_name: str, payload: dict[str, Any]) -> str:
    kind = str(payload.get("kind") or "media")
    name = str(payload.get("name") or payload.get("source_path") or payload.get("output_path") or "").strip()
    if event_name == "started":
        return f"Media worker started {kind} package"
    if event_name == "entry_started":
        return f"Packaging {name}" if name else "Packaging entry"
    if event_name == "entry_finished":
        return f"Packaged {name}" if name else "Packaged entry"
    if event_name == "copy_started":
        return "Copying track artifact"
    if event_name == "metadata_started":
        return "Embedding rich metadata"
    if event_name == "finished":
        return f"Media worker finished {kind} package"
    if event_name == "cancelled":
        return "Media worker job cancelled"
    if event_name == "failed":
        errors = payload.get("errors")
        if isinstance(errors, list) and errors:
            return str(errors[0])
        return "Media worker job failed"
    return event_name.replace("_", " ")


def _int_value(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


__all__ = [
    "bridge_media_worker_task_events",
    "acquire_media_worker_slot",
    "cancel_media_worker_job",
    "get_media_worker_job",
    "get_media_worker_runtime",
    "media_worker_admission",
    "media_worker_cancel_key",
    "media_worker_events_stream",
    "media_worker_job_key",
    "media_worker_max_active",
    "media_worker_slot_key",
]
