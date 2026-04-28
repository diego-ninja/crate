"""Snapshot builders for admin stack surfaces."""

from __future__ import annotations

from crate.db.ui_snapshot_store import get_or_build_ui_snapshot
from crate.docker_ctl import is_available, list_containers

STACK_SNAPSHOT_SCOPE = "ops:stack"
STACK_SNAPSHOT_MAX_AGE = 30
STACK_SNAPSHOT_STALE_MAX_AGE = 180


def build_stack_surface_payload() -> dict:
    available = is_available()
    if not available:
        return {
            "stack": {
                "available": False,
                "total": 0,
                "running": 0,
                "containers": [],
            }
        }

    containers = list_containers(all_containers=True)
    running = sum(1 for container in containers if container.get("state") == "running")
    return {
        "stack": {
            "available": True,
            "total": len(containers),
            "running": running,
            "containers": containers,
        }
    }


def get_cached_stack_surface(*, fresh: bool = False) -> dict:
    return get_or_build_ui_snapshot(
        scope=STACK_SNAPSHOT_SCOPE,
        subject_key="global",
        max_age_seconds=STACK_SNAPSHOT_MAX_AGE,
        stale_max_age_seconds=STACK_SNAPSHOT_STALE_MAX_AGE,
        fresh=fresh,
        allow_stale_on_error=True,
        build=build_stack_surface_payload,
    )


def publish_stack_surface_signal() -> None:
    get_cached_stack_surface(fresh=True)


__all__ = [
    "STACK_SNAPSHOT_SCOPE",
    "STACK_SNAPSHOT_MAX_AGE",
    "STACK_SNAPSHOT_STALE_MAX_AGE",
    "build_stack_surface_payload",
    "get_cached_stack_surface",
    "publish_stack_surface_signal",
]
