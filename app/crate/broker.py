"""Dramatiq broker configuration.

Redis DB 0 = cache (existing), DB 1 = Dramatiq message broker.
Redis must use volatile-lru policy so cache keys (with TTL) can be evicted
but Dramatiq queue keys (no TTL) are never lost.
"""

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

from crate.config import get_durable_redis_url
from crate.observability import init_sentry

log = logging.getLogger(__name__)

# Switch to DB 1 for broker (DB 0 is cache)
_BROKER_URL = get_durable_redis_url().rsplit("/", 1)[0] + "/1"


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
init_sentry("workers")
broker = get_broker()
dramatiq.set_broker(broker)
