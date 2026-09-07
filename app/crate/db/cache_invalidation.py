"""Bounded cross-process invalidation for process-local L1 caches."""

from __future__ import annotations

import json
import logging
import queue
import threading
import time
from collections.abc import Callable
from typing import Any

from crate.db.cache_runtime import _mem_clear, _mem_delete_prefix
from crate.db.domain_event_outbox import enqueue_outbox_event
from crate.db.tx import transaction_scope

log = logging.getLogger(__name__)

_EVENTS_KEY = "cache:invalidation:events"
_EVENT_ID_KEY = "cache:invalidation:next_id"

_SCOPE_CACHE_PREFIXES = {
    "home": ("home:", "home_playlist:", "home_section:"),
    "history": ("stats:",),
    "library": (
        "discover:",
        "listen:artist_page:",
        "listen:browse_filters:",
        "listen:explore_page:",
    ),
    "shows": ("shows:",),
    "upcoming": ("upcoming:",),
    "playlists": ("playlist:",),
    "curation": ("curation:",),
    "artist_bio": ("enrichment:", "lastfm:artist:", "listen:artist_page:"),
}


def cache_prefixes_for_scopes(scopes: tuple[str, ...] | list[str]) -> set[str]:
    prefixes: set[str] = set()
    for scope in scopes:
        prefixes.update(_SCOPE_CACHE_PREFIXES.get(scope, ()))
        if ":" in scope:
            prefixes.add(scope)
        if scope.startswith("artist:"):
            prefixes.add("listen:artist_page:")
    return prefixes


def apply_remote_invalidation_event(raw_event: str | bytes | dict[str, Any]) -> None:
    try:
        event = (
            raw_event
            if isinstance(raw_event, dict)
            else json.loads(
                raw_event.decode() if isinstance(raw_event, bytes) else raw_event
            )
        )
    except (json.JSONDecodeError, UnicodeDecodeError, TypeError):
        return
    scope = str(event.get("scope") or "")
    if not scope:
        return
    if scope == "*":
        _mem_clear()
        return
    for prefix in cache_prefixes_for_scopes([scope]):
        _mem_delete_prefix(prefix)


def persist_invalidation_events(scopes: tuple[str, ...]) -> None:
    """Commit projector invalidations atomically before volatile dispatch."""
    if not scopes:
        return
    with transaction_scope() as session:
        for scope in scopes:
            enqueue_outbox_event(
                "ui.invalidate",
                {"scope": scope},
                scope="ui.invalidate",
                subject_key=scope,
                session=session,
            )


class BoundedInvalidationDispatcher:
    def __init__(
        self,
        handler: Callable[[tuple[str, ...]], None],
        *,
        max_pending: int = 256,
    ) -> None:
        self._handler = handler
        self._queue: queue.Queue[tuple[str, ...] | None] = queue.Queue(
            maxsize=max(1, max_pending)
        )
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._overflow_pending = False
        self._processed = 0
        self._coalesced = 0

    def start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._stop.clear()
            self._thread = threading.Thread(
                target=self._run,
                name="cache-invalidation-dispatcher",
                daemon=True,
            )
            self._thread.start()

    def submit(self, scopes: tuple[str, ...]) -> bool:
        normalized = tuple(dict.fromkeys(scope for scope in scopes if scope))
        if not normalized:
            return True
        try:
            self._queue.put_nowait(normalized)
            return True
        except queue.Full:
            with self._lock:
                self._overflow_pending = True
                self._coalesced += 1
            return False

    def wait_until_idle(self, *, timeout: float) -> bool:
        deadline = time.monotonic() + max(0, timeout)
        while time.monotonic() <= deadline:
            with self._lock:
                overflow_pending = self._overflow_pending
            if self._queue.unfinished_tasks == 0 and not overflow_pending:
                return True
            time.sleep(0.005)
        return False

    def stop(self, *, timeout: float = 2.0) -> None:
        self._stop.set()
        try:
            self._queue.put_nowait(None)
        except queue.Full:
            pass
        thread = self._thread
        if thread:
            thread.join(timeout=max(0, timeout))

    def stats(self) -> dict[str, int]:
        with self._lock:
            return {
                "pending": self._queue.qsize(),
                "processed": self._processed,
                "coalesced": self._coalesced,
            }

    def _run(self) -> None:
        while not self._stop.is_set() or self._queue.unfinished_tasks:
            try:
                item = self._queue.get(timeout=0.1)
            except queue.Empty:
                continue
            try:
                if item is not None:
                    self._invoke(item)
                with self._lock:
                    overflow_pending = self._overflow_pending
                    self._overflow_pending = False
                if overflow_pending:
                    self._invoke(("*",))
            finally:
                self._queue.task_done()
            if item is None:
                return

    def _invoke(self, scopes: tuple[str, ...]) -> None:
        try:
            self._handler(scopes)
        except Exception:
            log.warning("Cache invalidation handler failed", exc_info=True)
        finally:
            with self._lock:
                self._processed += 1


class CacheInvalidationSubscriber:
    def __init__(
        self,
        redis_factory: Callable[[], Any],
        channel: str,
        *,
        retry_delay: float = 1.0,
    ) -> None:
        self._redis_factory = redis_factory
        self._channel = channel
        self._retry_delay = max(0.01, float(retry_delay))
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_event_id: int | None = None
        self._connected_once = False

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="cache-invalidation-subscriber",
            daemon=True,
        )
        self._thread.start()

    def stop(self, *, timeout: float = 2.0) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=max(0, timeout))

    def _run(self) -> None:
        while not self._stop.is_set():
            pubsub = None
            try:
                redis_client = self._redis_factory()
                pubsub = redis_client.pubsub(ignore_subscribe_messages=True)
                pubsub.subscribe(self._channel)
                if self._connected_once:
                    self._replay_gap(redis_client)
                else:
                    self._last_event_id = self._latest_event_id(redis_client)
                    self._connected_once = True
                while not self._stop.is_set():
                    message = pubsub.get_message(timeout=1.0)
                    if message and message.get("type") == "message":
                        self._apply_if_new(message.get("data"))
            except Exception:
                log.warning(
                    "Cache invalidation subscriber disconnected; retrying",
                    exc_info=True,
                )
            finally:
                if pubsub is not None:
                    try:
                        pubsub.close()
                    except Exception:
                        pass
            self._stop.wait(self._retry_delay)

    def _latest_event_id(self, redis_client: Any) -> int:
        try:
            return max(0, int(redis_client.get(_EVENT_ID_KEY) or 0))
        except (AttributeError, TypeError, ValueError):
            return 0

    def _replay_gap(self, redis_client: Any) -> None:
        try:
            raw_events = redis_client.lrange(_EVENTS_KEY, 0, -1)
        except Exception:
            log.warning(
                "Unable to replay cache invalidations after reconnect", exc_info=True
            )
            _mem_clear()
            self._last_event_id = self._latest_event_id(redis_client)
            return
        for raw_event in reversed(raw_events):
            self._apply_if_new(raw_event)

    def _apply_if_new(self, raw_event: str | bytes | dict[str, Any] | None) -> None:
        try:
            event = (
                raw_event
                if isinstance(raw_event, dict)
                else json.loads(
                    raw_event.decode()
                    if isinstance(raw_event, bytes)
                    else str(raw_event or "")
                )
            )
            event_id = int(event.get("id") or 0)
        except (json.JSONDecodeError, UnicodeDecodeError, TypeError, ValueError):
            return
        if event_id <= int(self._last_event_id or 0):
            return
        apply_remote_invalidation_event(event)
        self._last_event_id = event_id


__all__ = [
    "BoundedInvalidationDispatcher",
    "CacheInvalidationSubscriber",
    "apply_remote_invalidation_event",
    "cache_prefixes_for_scopes",
    "persist_invalidation_events",
]
