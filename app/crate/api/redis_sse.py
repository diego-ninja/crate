"""Shared Redis asyncio helpers for SSE pub/sub streams."""

from __future__ import annotations

import inspect
import os
from importlib import import_module
from typing import Any

_redis_client: Any | None = None
_redis_pool: Any | None = None
_redis_module_marker: int | None = None
_redis_url: str | None = None


def _get_redis_url() -> str:
    return os.environ.get("REDIS_URL", "redis://localhost:6379/0")


def _max_connections() -> int:
    raw = os.environ.get("CRATE_SSE_REDIS_MAX_CONNECTIONS", "128")
    try:
        return max(8, min(512, int(raw)))
    except ValueError:
        return 128


def get_async_redis():
    global _redis_client, _redis_pool, _redis_module_marker, _redis_url

    redis_url = _get_redis_url()
    aioredis = import_module("redis.asyncio")
    module_marker = id(aioredis)
    if (
        _redis_client is not None
        and _redis_pool is not None
        and _redis_module_marker == module_marker
        and _redis_url == redis_url
    ):
        return _redis_client

    connection_pool = getattr(aioredis, "ConnectionPool", None)
    redis_cls = getattr(aioredis, "Redis", None)
    if connection_pool is not None and redis_cls is not None:
        _redis_pool = connection_pool.from_url(
            redis_url,
            decode_responses=True,
            max_connections=_max_connections(),
            socket_connect_timeout=2,
            socket_timeout=5,
        )
        _redis_client = redis_cls(connection_pool=_redis_pool)
    else:
        _redis_pool = object()
        _redis_client = aioredis.from_url(redis_url, decode_responses=True)
    _redis_module_marker = module_marker
    _redis_url = redis_url
    return _redis_client


async def open_pubsub(channel: str):
    redis = get_async_redis()
    pubsub = redis.pubsub()
    await pubsub.subscribe(channel)
    return pubsub


async def close_pubsub(pubsub, channel: str) -> None:
    try:
        await pubsub.unsubscribe(channel)
    finally:
        close = getattr(pubsub, "aclose", None)
        if close is not None:
            await close()
            return
        close = getattr(pubsub, "close", None)
        if close is not None:
            result = close()
            if inspect.isawaitable(result):
                await result
