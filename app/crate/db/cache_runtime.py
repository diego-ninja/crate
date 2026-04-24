"""Process-local and Redis-backed cache runtime primitives."""

from __future__ import annotations

import logging
import os
import time
from typing import Any

log = logging.getLogger(__name__)

_mem_cache: dict[str, tuple[float, Any]] = {}
_MEM_TTL = 300
_MEM_MAX_SIZE = 10000

_redis_client = None


def _mem_get(key: str) -> Any | None:
    entry = _mem_cache.get(key)
    if entry and entry[0] > time.time():
        return entry[1]
    if entry:
        del _mem_cache[key]
    return None


def _mem_set(key: str, value: Any, ttl: int = _MEM_TTL) -> None:
    if len(_mem_cache) >= _MEM_MAX_SIZE:
        sorted_keys = sorted(_mem_cache, key=lambda cache_key: _mem_cache[cache_key][0])
        for cache_key in sorted_keys[: _MEM_MAX_SIZE // 5]:
            del _mem_cache[cache_key]
    _mem_cache[key] = (time.time() + ttl, value)


def _mem_delete(key: str) -> None:
    _mem_cache.pop(key, None)


def _get_redis():
    global _redis_client
    if _redis_client is None:
        import redis as _redis

        url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
        try:
            _redis_client = _redis.from_url(url, decode_responses=True, socket_timeout=2, socket_connect_timeout=2)
            _redis_client.ping()
            log.info("Redis connected: %s", url)
        except Exception as exc:
            log.warning("Redis not available (%s), falling back to PostgreSQL: %s", url, exc)
            _redis_client = None
    return _redis_client


__all__ = [
    "_get_redis",
    "_MEM_MAX_SIZE",
    "_MEM_TTL",
    "_mem_cache",
    "_mem_delete",
    "_mem_get",
    "_mem_set",
]
