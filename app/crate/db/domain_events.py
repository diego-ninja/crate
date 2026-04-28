"""Ephemeral domain-event bus backed by Redis Streams.

Events are short-lived signals consumed by the projector to warm UI
snapshots. They are published only after the surrounding SQLAlchemy
transaction commits so the projector never races ahead of database
state.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from crate.db.tx import register_after_commit

log = logging.getLogger(__name__)

_STREAM_KEY = "crate:domain_events"
_GROUP_NAME = "projector"
_SEQ_COUNTER_KEY = "crate:domain_events:seq"
_MAX_LEN = 5000
_BLOCK_MS = 1000

_redis_client = None
_group_created = False


def _get_redis():
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    try:
        import redis as _redis

        url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
        _redis_client = _redis.from_url(
            url,
            decode_responses=True,
            socket_timeout=2,
            socket_connect_timeout=2,
        )
        _redis_client.ping()
    except Exception:
        _redis_client = None
    return _redis_client


def _ensure_consumer_group() -> bool:
    global _group_created
    if _group_created:
        return True

    r = _get_redis()
    if not r:
        return False

    try:
        r.xgroup_create(_STREAM_KEY, _GROUP_NAME, id="0", mkstream=True)
        _group_created = True
    except Exception as exc:
        if "BUSYGROUP" in str(exc):
            _group_created = True
        else:
            log.debug("Could not create domain-event consumer group", exc_info=True)
            return False
    return True


def _publish_domain_event(
    event_type: str,
    payload: dict[str, Any] | None = None,
    *,
    scope: str | None = None,
    subject_key: str | None = None,
) -> int:
    r = _get_redis()
    if not r:
        return 0
    try:
        r.xadd(
            _STREAM_KEY,
            {
                "event_type": event_type,
                "scope": scope or "",
                "subject_key": subject_key or "",
                "payload_json": json.dumps(payload or {}, default=str),
            },
            maxlen=_MAX_LEN,
            approximate=True,
        )
        return int(r.incr(_SEQ_COUNTER_KEY))
    except Exception:
        log.debug("Failed to append domain event %s", event_type, exc_info=True)
        return 0


def append_domain_event(
    event_type: str,
    payload: dict[str, Any] | None = None,
    *,
    scope: str | None = None,
    subject_key: str | None = None,
    session=None,
) -> int:
    """Append a domain event to the Redis stream.

    When a SQLAlchemy ``session`` is supplied, publishing is deferred
    until after commit so the projector only sees committed state.
    """

    if session is not None:
        register_after_commit(
            session,
            lambda: _publish_domain_event(
                event_type,
                payload,
                scope=scope,
                subject_key=subject_key,
            ),
        )
        return 0

    return _publish_domain_event(
        event_type,
        payload,
        scope=scope,
        subject_key=subject_key,
    )


def get_latest_domain_event_id(*, scope: str | None = None, subject_key: str | None = None) -> int:
    """Return the latest monotonic sequence used for snapshot versioning."""

    del scope, subject_key
    r = _get_redis()
    if not r:
        return 0
    try:
        value = r.get(_SEQ_COUNTER_KEY)
        return int(value) if value else 0
    except Exception:
        return 0


def _decode_stream_messages(messages: list[tuple[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for msg_id, fields in messages:
        payload_raw = fields.get("payload_json", "{}")
        try:
            payload = json.loads(payload_raw)
        except (json.JSONDecodeError, TypeError):
            payload = {}
        result.append(
            {
                "id": msg_id,
                "event_type": fields.get("event_type", ""),
                "scope": fields.get("scope", ""),
                "subject_key": fields.get("subject_key", ""),
                "payload_json": payload,
            }
        )
    return result


def list_domain_events(
    *,
    limit: int = 100,
    unprocessed_only: bool = True,
    consumer_name: str = "worker",
    block_ms: int = _BLOCK_MS,
) -> list[dict[str, Any]]:
    """Read domain events from Redis Streams.

    ``unprocessed_only=True`` uses a consumer group. It first retries
    this consumer's pending messages (`id="0"`) so projector crashes do
    not strand events forever, then falls back to new messages (`id=">"`).
    """

    r = _get_redis()
    if not r:
        return []

    count = max(1, min(limit, 1000))

    try:
        if not unprocessed_only:
            return _decode_stream_messages(r.xrange(_STREAM_KEY, "-", "+", count=count))

        if not _ensure_consumer_group():
            return []

        entries = r.xreadgroup(
            _GROUP_NAME,
            consumer_name,
            {_STREAM_KEY: "0"},
            count=count,
        )
        if not entries:
            entries = r.xreadgroup(
                _GROUP_NAME,
                consumer_name,
                {_STREAM_KEY: ">"},
                count=count,
                block=max(0, int(block_ms)),
            )
    except Exception:
        log.debug("Failed to read domain events from stream", exc_info=True)
        return []

    if not entries:
        return []

    messages: list[tuple[str, dict[str, Any]]] = []
    for _stream_name, stream_messages in entries:
        messages.extend(stream_messages)
    return _decode_stream_messages(messages)


def get_domain_event_runtime(*, limit: int = 10) -> dict[str, Any]:
    """Return Redis stream diagnostics for the domain-event bus."""

    safe_limit = max(1, min(int(limit or 10), 50))
    runtime: dict[str, Any] = {
        "redis_connected": False,
        "stream_key": _STREAM_KEY,
        "consumer_group": _GROUP_NAME,
        "latest_sequence": get_latest_domain_event_id(),
        "stream_length": 0,
        "pending": 0,
        "consumers": 0,
        "lag": 0,
        "last_delivered_id": None,
        "recent_events": [],
    }

    r = _get_redis()
    if not r:
        return runtime

    runtime["redis_connected"] = True

    try:
        runtime["stream_length"] = int(r.xlen(_STREAM_KEY) or 0)
    except Exception:
        log.debug("Failed to inspect domain-event stream length", exc_info=True)

    try:
        groups = r.xinfo_groups(_STREAM_KEY) or []
        group = next((item for item in groups if item.get("name") == _GROUP_NAME), None)
        if group:
            runtime["pending"] = int(group.get("pending", 0) or 0)
            runtime["consumers"] = int(group.get("consumers", 0) or 0)
            lag = group.get("lag")
            runtime["lag"] = int(lag) if lag not in (None, "") else 0
            runtime["last_delivered_id"] = group.get("last-delivered-id") or group.get("last_delivered_id")
    except Exception:
        log.debug("Failed to inspect domain-event consumer group", exc_info=True)

    try:
        recent = r.xrevrange(_STREAM_KEY, "+", "-", count=safe_limit)
        runtime["recent_events"] = _decode_stream_messages(recent)
    except Exception:
        log.debug("Failed to inspect recent domain events", exc_info=True)

    return runtime


def mark_domain_events_processed(event_ids: list, *, session=None) -> None:
    """Acknowledge processed events in the consumer group."""

    del session
    cleaned = [str(event_id) for event_id in event_ids if event_id]
    if not cleaned:
        return

    r = _get_redis()
    if not r or not _ensure_consumer_group():
        return

    try:
        r.xack(_STREAM_KEY, _GROUP_NAME, *cleaned)
    except Exception:
        log.debug("Failed to ack domain events", exc_info=True)


__all__ = [
    "append_domain_event",
    "get_domain_event_runtime",
    "get_latest_domain_event_id",
    "list_domain_events",
    "mark_domain_events_processed",
]
