"""Small Redis-backed rate limit helpers for external providers."""

from __future__ import annotations

import logging
import threading
import time

from crate.db.cache_runtime import _get_redis

log = logging.getLogger(__name__)

_FALLBACK_LOCK = threading.Lock()
_FALLBACK_NEXT_AT: dict[str, float] = {}

_RESERVE_SLOT_SCRIPT = """
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
local now = tonumber(ARGV[1])
local interval = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local allowed = now
if current > now then
  allowed = current
end
redis.call("SET", KEYS[1], tostring(allowed + interval), "PX", ttl)
return allowed - now
"""


def _fallback_wait(key: str, interval_seconds: float) -> float:
    now = time.time()
    with _FALLBACK_LOCK:
        allowed = max(now, _FALLBACK_NEXT_AT.get(key, 0.0))
        _FALLBACK_NEXT_AT[key] = allowed + interval_seconds
    return max(0.0, allowed - now)


def reserve_provider_slot(provider: str, interval_seconds: float) -> float:
    """Reserve the next provider slot and return how long the caller should wait."""
    interval = max(0.0, float(interval_seconds or 0.0))
    if interval <= 0:
        return 0.0

    key = f"rate:provider:{provider.strip().lower()}"
    redis_client = _get_redis()
    if redis_client is not None:
        try:
            now_ms = int(time.time() * 1000)
            interval_ms = max(1, int(interval * 1000))
            ttl_ms = max(interval_ms * 2, interval_ms + 60000)
            wait_ms = redis_client.eval(
                _RESERVE_SLOT_SCRIPT,
                1,
                key,
                now_ms,
                interval_ms,
                ttl_ms,
            )
            return max(0.0, float(wait_ms or 0) / 1000.0)
        except Exception:
            log.debug("Redis provider rate limiter failed for %s", provider, exc_info=True)

    return _fallback_wait(key, interval)


def wait_for_provider_slot(provider: str, interval_seconds: float) -> float:
    """Block until the caller owns the next provider slot."""
    wait_seconds = reserve_provider_slot(provider, interval_seconds)
    if wait_seconds > 0:
        time.sleep(wait_seconds)
    return wait_seconds


__all__ = ["reserve_provider_slot", "wait_for_provider_slot"]
