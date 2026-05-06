"""Stack management API — monitor and control Docker containers."""

from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from starlette.responses import StreamingResponse

from crate.api._deps import json_dumps
from crate.api.auth import _require_admin
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.redis_sse import close_pubsub, open_pubsub
from crate.api.schemas.utility import (
    AdminStackSnapshotResponse,
    StackActionResponse,
    StackContainerDetailResponse,
    StackContainerLogsResponse,
    StackStatusResponse,
)
from crate.db.admin_stack_surface import STACK_SNAPSHOT_SCOPE, get_cached_stack_surface, publish_stack_surface_signal
from crate.db.snapshot_events import snapshot_channel
from crate.docker_ctl import (
    get_container,
    get_container_logs,
    restart_container,
    start_container,
    stop_container,
)

log = logging.getLogger(__name__)
router = APIRouter(tags=["stack"])

_STACK_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        403: error_response("The container is not managed by Crate."),
        404: error_response("The requested container could not be found."),
        500: error_response("The container operation failed."),
    },
)


async def _stack_stream() -> AsyncIterator[str]:
    yield f"data: {json_dumps(get_cached_stack_surface())}\n\n"
    pubsub = None
    channel = snapshot_channel(STACK_SNAPSHOT_SCOPE, "global")
    try:
        pubsub = await open_pubsub(channel)
        heartbeat_counter = 0
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message and message.get("type") == "message":
                yield f"data: {json_dumps(get_cached_stack_surface())}\n\n"
                heartbeat_counter = 0
                continue
            heartbeat_counter += 1
            if heartbeat_counter >= 30:
                heartbeat_counter = 0
                yield ": heartbeat\n\n"
    except Exception:
        while True:
            yield f"data: {json_dumps(get_cached_stack_surface())}\n\n"
            await asyncio.sleep(30)
    finally:
        if pubsub is not None:
            await close_pubsub(pubsub, channel)


@router.get(
    "/api/admin/stack-snapshot",
    response_model=AdminStackSnapshotResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the canonical admin stack snapshot",
)
def admin_stack_snapshot(request: Request, fresh: bool = False):
    _require_admin(request)
    return get_cached_stack_surface(fresh=fresh)


@router.get(
    "/api/admin/stack-stream",
    responses=AUTH_ERROR_RESPONSES,
    summary="Stream admin stack snapshot updates",
)
async def admin_stack_stream(request: Request):
    _require_admin(request)
    return StreamingResponse(
        _stack_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get(
    "/api/stack/status",
    response_model=StackStatusResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get Docker stack status",
)
def stack_status(request: Request, fresh: bool = False):
    _require_admin(request)
    snapshot = get_cached_stack_surface(fresh=fresh)
    return snapshot.get("stack") or {"available": False, "total": 0, "running": 0, "containers": []}


@router.get(
    "/api/stack/container/{name}",
    response_model=StackContainerDetailResponse,
    responses=_STACK_RESPONSES,
    summary="Get one container from the Docker stack",
)
def stack_container(request: Request, name: str):
    _require_admin(request)
    info = get_container(name)
    if not info:
        raise HTTPException(status_code=404, detail="Container not found")
    return info


@router.get(
    "/api/stack/container/{name}/logs",
    response_model=StackContainerLogsResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get recent logs for a container",
)
def stack_container_logs(request: Request, name: str, tail: int = 50):
    _require_admin(request)
    logs = get_container_logs(name, tail)
    return {"name": name, "logs": logs}


@router.post(
    "/api/stack/container/{name}/restart",
    response_model=StackActionResponse,
    responses=_STACK_RESPONSES,
    summary="Restart a managed container",
)
def stack_restart_container(request: Request, name: str):
    _require_admin(request)
    # Safety: only allow restarting crate containers
    allowed_prefixes = [
        "librarian-", "tidarr", "tidalrr",
        "slskd", "soulsync", "traefik", "nginx",
    ]
    if not any(name.startswith(p) for p in allowed_prefixes):
        raise HTTPException(status_code=403, detail=f"Cannot restart '{name}': not a managed container")

    ok = restart_container(name)
    if ok:
        publish_stack_surface_signal()
        return {"status": "restarting", "name": name}
    raise HTTPException(status_code=500, detail="Restart failed")


ALLOWED_PREFIXES = [
    "librarian-", "tidarr", "tidalrr",
    "slskd", "soulsync", "traefik", "nginx",
]


def _is_allowed(name: str) -> bool:
    return any(name.startswith(p) for p in ALLOWED_PREFIXES)


@router.post(
    "/api/stack/container/{name}/stop",
    response_model=StackActionResponse,
    responses=_STACK_RESPONSES,
    summary="Stop a managed container",
)
def stack_stop_container(request: Request, name: str):
    _require_admin(request)
    if not _is_allowed(name):
        raise HTTPException(status_code=403, detail=f"Cannot stop '{name}': not a managed container")
    ok = stop_container(name)
    if ok:
        publish_stack_surface_signal()
        return {"status": "stopped", "name": name}
    raise HTTPException(status_code=500, detail="Stop failed")


@router.post(
    "/api/stack/container/{name}/start",
    response_model=StackActionResponse,
    responses=_STACK_RESPONSES,
    summary="Start a managed container",
)
def stack_start_container(request: Request, name: str):
    _require_admin(request)
    if not _is_allowed(name):
        raise HTTPException(status_code=403, detail=f"Cannot start '{name}': not a managed container")
    ok = start_container(name)
    if ok:
        publish_stack_surface_signal()
        return {"status": "started", "name": name}
    raise HTTPException(status_code=500, detail="Start failed")
