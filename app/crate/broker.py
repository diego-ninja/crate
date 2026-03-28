"""Dramatiq broker configuration.

Redis DB 0 = cache (existing), DB 1 = Dramatiq message broker.
Redis must use volatile-lru policy so cache keys (with TTL) can be evicted
but Dramatiq queue keys (no TTL) are never lost.
"""

import os
import logging

import dramatiq
from dramatiq.brokers.redis import RedisBroker
from dramatiq.middleware import (
    AgeLimit,
    Callbacks,
    Pipelines,
    Retries,
    ShutdownNotifications,
    TimeLimit,
)

log = logging.getLogger(__name__)

_REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
# Switch to DB 1 for broker (DB 0 is cache)
_BROKER_URL = _REDIS_URL.rsplit("/", 1)[0] + "/1"


def get_broker() -> RedisBroker:
    """Create and configure the Dramatiq Redis broker."""
    middleware = [
        AgeLimit(),
        TimeLimit(),
        ShutdownNotifications(),
        Callbacks(),
        Pipelines(),
        Retries(max_retries=0),  # default no retry; actors override per-type
    ]
    broker = RedisBroker(url=_BROKER_URL, middleware=middleware)
    return broker


# Module-level broker — set on import so actors can register
broker = get_broker()
dramatiq.set_broker(broker)
