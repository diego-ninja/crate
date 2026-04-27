from __future__ import annotations

import logging
import secrets
import time
from collections.abc import Callable
from threading import Event, Lock

log = logging.getLogger(__name__)

_home_cache_singleflight_guard = Lock()
_home_cache_singleflight_events: dict[str, Event] = {}
_HOME_CACHE_READY_CHANNEL_PREFIX = "crate:home-cache:ready:"


def _home_cache_scope(cache_key: str) -> str:
    parts = cache_key.split(":")
    return parts[1] if len(parts) > 1 else cache_key


def _record_home_metric(name: str, *, cache_key: str, value: float = 1.0):
    try:
        from crate.metrics import record, record_counter

        tags = {"scope": _home_cache_scope(cache_key)}
        if name.endswith(".ms"):
            record(name, value, tags)
        else:
            record_counter(name, tags)
    except Exception:
        return


def _home_cache_ready_channel(cache_key: str) -> str:
    return f"{_HOME_CACHE_READY_CHANNEL_PREFIX}{cache_key}"


def _get_or_compute_home_cache(
    cache_key: str,
    *,
    max_age_seconds: int,
    ttl: int,
    compute: Callable[[], dict],
    fresh: bool = False,
    allow_stale_on_error: bool = False,
    stale_max_age_seconds: int | None = None,
    wait_timeout_seconds: float = 10.0,
) -> dict:
    from crate.db.cache_store import get_cache, set_cache

    def _close_wait_pubsub(pubsub: object | None, channel: str) -> None:
        if pubsub is None:
            return
        try:
            pubsub.unsubscribe(channel)
        except Exception:
            log.debug("Failed to unsubscribe home cache pubsub", exc_info=True)
        try:
            pubsub.close()
        except Exception:
            log.debug("Failed to close home cache pubsub", exc_info=True)

    def _wait_for_cached_value(*, redis_client: object | None = None) -> dict | None:
        deadline = time.time() + wait_timeout_seconds
        poll_sleep_seconds = 0.1
        channel = _home_cache_ready_channel(cache_key)
        pubsub = None

        if redis_client is not None:
            try:
                pubsub = redis_client.pubsub()
                pubsub.subscribe(channel)
            except Exception:
                pubsub = None

        try:
            while time.time() < deadline:
                cached_value = get_cache(cache_key, max_age_seconds=max_age_seconds)
                if cached_value is not None:
                    return cached_value

                remaining = deadline - time.time()
                if remaining <= 0:
                    break

                if pubsub is not None:
                    try:
                        pubsub.get_message(
                            ignore_subscribe_messages=True,
                            timeout=min(remaining, 1.0),
                        )
                    except Exception:
                        _close_wait_pubsub(pubsub, channel)
                        pubsub = None
                        continue
                else:
                    time.sleep(min(poll_sleep_seconds, remaining))
                    poll_sleep_seconds = min(poll_sleep_seconds * 2, 1.0)

            return None
        finally:
            _close_wait_pubsub(pubsub, channel)

    def _acquire_distributed_lock() -> tuple[object, str, str] | None | bool:
        from crate.db.cache_runtime import _get_redis

        redis_client = _get_redis()
        if not redis_client:
            return None
        lock_key = f"lock:{cache_key}"
        token = secrets.token_urlsafe(12)
        try:
            acquired = redis_client.set(lock_key, token, ex=max(int(wait_timeout_seconds) + 5, 15), nx=True)
        except Exception:
            return None
        if acquired:
            return redis_client, lock_key, token
        return False

    def _release_distributed_lock(lock_state: tuple[object, str, str] | None):
        if not lock_state:
            return
        redis_client, lock_key, token = lock_state
        try:
            redis_client.eval(
                """
                if redis.call('get', KEYS[1]) == ARGV[1] then
                    return redis.call('del', KEYS[1])
                end
                return 0
                """,
                1,
                lock_key,
                token,
            )
        except Exception:
            return

    def _publish_cache_ready(lock_state: tuple[object, str, str] | None):
        if not lock_state:
            return
        redis_client, _, _ = lock_state
        try:
            redis_client.publish(_home_cache_ready_channel(cache_key), str(time.time()))
        except Exception:
            log.debug("Failed to publish home cache ready notification", exc_info=True)

    if not fresh:
        cached = get_cache(cache_key, max_age_seconds=max_age_seconds)
        if cached is not None:
            _record_home_metric("home.cache.hit", cache_key=cache_key)
            return cached
    _record_home_metric("home.cache.miss", cache_key=cache_key)

    is_owner = False
    wait_event: Event
    with _home_cache_singleflight_guard:
        wait_event = _home_cache_singleflight_events.get(cache_key)
        if wait_event is None:
            wait_event = Event()
            _home_cache_singleflight_events[cache_key] = wait_event
            is_owner = True

    if not is_owner:
        if wait_event.wait(wait_timeout_seconds):
            cached = get_cache(cache_key, max_age_seconds=max_age_seconds)
            if cached is not None:
                _record_home_metric("home.cache.coalesced", cache_key=cache_key)
                return cached
        waited = _wait_for_cached_value()
        if waited is not None:
            _record_home_metric("home.cache.waited", cache_key=cache_key)
            return waited

    distributed_lock = _acquire_distributed_lock()
    if distributed_lock is False:
        from crate.db.cache_runtime import _get_redis

        waited = _wait_for_cached_value(redis_client=_get_redis())
        if waited is not None:
            _record_home_metric("home.cache.waited", cache_key=cache_key)
            return waited
        distributed_lock = None

    try:
        started = time.monotonic()
        value = compute()
        elapsed_ms = (time.monotonic() - started) * 1000
        _record_home_metric("home.compute.ms", cache_key=cache_key, value=elapsed_ms)
        if elapsed_ms >= 1000:
            log.info("Slow home cache compute for %s: %.1fms", cache_key, elapsed_ms)
        set_cache(cache_key, value, ttl=ttl)
        return value
    except Exception:
        if allow_stale_on_error and stale_max_age_seconds is not None:
            stale = get_cache(cache_key, max_age_seconds=stale_max_age_seconds)
            if stale is not None:
                _record_home_metric("home.cache.stale_fallback", cache_key=cache_key)
                return stale
        raise
    finally:
        lock_state = distributed_lock if isinstance(distributed_lock, tuple) else None
        _publish_cache_ready(lock_state)
        _release_distributed_lock(lock_state)
        if is_owner:
            with _home_cache_singleflight_guard:
                current = _home_cache_singleflight_events.pop(cache_key, None)
                if current is not None:
                    current.set()
