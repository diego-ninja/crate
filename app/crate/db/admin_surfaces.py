"""Compatibility facade for admin operational surfaces."""

from __future__ import annotations

from crate.db.admin_health_surface import (
    HEALTH_SNAPSHOT_MAX_AGE,
    HEALTH_SNAPSHOT_SCOPE,
    HEALTH_SNAPSHOT_STALE_MAX_AGE,
    HEALTH_SURFACE_STREAM_CHANNEL,
    build_health_surface_payload,
    get_cached_health_surface,
    get_health_surface_subject,
    publish_health_surface_signal,
)
from crate.db.admin_logs_surface import (
    LOGS_SNAPSHOT_MAX_AGE,
    LOGS_SNAPSHOT_SCOPE,
    LOGS_SNAPSHOT_STALE_MAX_AGE,
    LOGS_SURFACE_STREAM_CHANNEL,
    build_logs_surface_payload,
    get_cached_logs_surface,
)
from crate.db.admin_stack_surface import (
    STACK_SNAPSHOT_MAX_AGE,
    STACK_SNAPSHOT_SCOPE,
    STACK_SNAPSHOT_STALE_MAX_AGE,
    build_stack_surface_payload,
    get_cached_stack_surface,
    publish_stack_surface_signal,
)
from crate.db.admin_tasks_surface import (
    TASKS_SNAPSHOT_MAX_AGE,
    TASKS_SNAPSHOT_SCOPE,
    TASKS_SNAPSHOT_STALE_MAX_AGE,
    TASKS_SURFACE_STREAM_CHANNEL,
    build_tasks_surface_payload,
    get_cached_tasks_surface,
    publish_tasks_surface_signal,
    serialize_task_surface,
)


__all__ = [
    "HEALTH_SNAPSHOT_MAX_AGE",
    "HEALTH_SNAPSHOT_SCOPE",
    "HEALTH_SNAPSHOT_STALE_MAX_AGE",
    "HEALTH_SURFACE_STREAM_CHANNEL",
    "LOGS_SNAPSHOT_MAX_AGE",
    "LOGS_SNAPSHOT_SCOPE",
    "LOGS_SNAPSHOT_STALE_MAX_AGE",
    "LOGS_SURFACE_STREAM_CHANNEL",
    "STACK_SNAPSHOT_MAX_AGE",
    "STACK_SNAPSHOT_SCOPE",
    "STACK_SNAPSHOT_STALE_MAX_AGE",
    "TASKS_SNAPSHOT_MAX_AGE",
    "TASKS_SNAPSHOT_SCOPE",
    "TASKS_SNAPSHOT_STALE_MAX_AGE",
    "TASKS_SURFACE_STREAM_CHANNEL",
    "build_health_surface_payload",
    "build_logs_surface_payload",
    "build_stack_surface_payload",
    "build_tasks_surface_payload",
    "get_cached_health_surface",
    "get_cached_logs_surface",
    "get_cached_stack_surface",
    "get_cached_tasks_surface",
    "get_health_surface_subject",
    "publish_health_surface_signal",
    "publish_stack_surface_signal",
    "publish_tasks_surface_signal",
    "serialize_task_surface",
]
