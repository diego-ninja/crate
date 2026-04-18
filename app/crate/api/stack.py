"""Stack management API — monitor and control Docker containers."""

import logging

from fastapi import APIRouter, HTTPException, Request

from crate.api.auth import _require_admin
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.utility import (
    StackActionResponse,
    StackContainerDetailResponse,
    StackContainerLogsResponse,
    StackStatusResponse,
)
from crate.docker_ctl import (
    is_available,
    list_containers,
    get_container,
    restart_container,
    stop_container,
    start_container,
    get_container_logs,
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

@router.get(
    "/api/stack/status",
    response_model=StackStatusResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get Docker stack status",
)
def stack_status(request: Request):
    _require_admin(request)
    available = is_available()
    if not available:
        return {"available": False, "containers": []}
    containers = list_containers(all_containers=True)
    running = sum(1 for c in containers if c["state"] == "running")
    return {
        "available": True,
        "total": len(containers),
        "running": running,
        "containers": containers,
    }


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
        "librarian-", "lidarr", "tidarr", "tidalrr",
        "slskd", "soulsync", "traefik", "authelia", "nginx",
    ]
    if not any(name.startswith(p) for p in allowed_prefixes):
        raise HTTPException(status_code=403, detail=f"Cannot restart '{name}': not a managed container")

    ok = restart_container(name)
    if ok:
        return {"status": "restarting", "name": name}
    raise HTTPException(status_code=500, detail="Restart failed")


ALLOWED_PREFIXES = [
    "librarian-", "lidarr", "tidarr", "tidalrr",
    "slskd", "soulsync", "traefik", "authelia", "nginx",
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
        return {"status": "started", "name": name}
    raise HTTPException(status_code=500, detail="Start failed")
