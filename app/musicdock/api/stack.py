"""Stack management API — monitor and control Docker containers."""

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from musicdock.api.auth import _require_admin
from musicdock.docker_ctl import (
    is_available,
    list_containers,
    get_container,
    restart_container,
    stop_container,
    start_container,
    get_container_logs,
)

log = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/stack/status")
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


@router.get("/api/stack/container/{name}")
def stack_container(request: Request, name: str):
    _require_admin(request)
    info = get_container(name)
    if not info:
        return JSONResponse({"error": "Container not found"}, status_code=404)
    return info


@router.get("/api/stack/container/{name}/logs")
def stack_container_logs(request: Request, name: str, tail: int = 50):
    _require_admin(request)
    logs = get_container_logs(name, tail)
    return {"name": name, "logs": logs}


class RestartRequest(BaseModel):
    name: str


@router.post("/api/stack/container/{name}/restart")
def stack_restart_container(request: Request, name: str):
    _require_admin(request)
    # Safety: only allow restarting musicdock containers
    allowed_prefixes = [
        "librarian-", "navidrome", "lidarr", "tidarr", "tidalrr",
        "slskd", "soulsync", "traefik", "authelia", "nginx",
    ]
    if not any(name.startswith(p) for p in allowed_prefixes):
        return JSONResponse(
            {"error": f"Cannot restart '{name}': not a managed container"},
            status_code=403,
        )

    ok = restart_container(name)
    if ok:
        return {"status": "restarting", "name": name}
    return JSONResponse({"error": "Restart failed"}, status_code=500)


ALLOWED_PREFIXES = [
    "librarian-", "navidrome", "lidarr", "tidarr", "tidalrr",
    "slskd", "soulsync", "traefik", "authelia", "nginx",
]


def _is_allowed(name: str) -> bool:
    return any(name.startswith(p) for p in ALLOWED_PREFIXES)


@router.post("/api/stack/container/{name}/stop")
def stack_stop_container(request: Request, name: str):
    _require_admin(request)
    if not _is_allowed(name):
        return JSONResponse({"error": f"Cannot stop '{name}': not a managed container"}, status_code=403)
    ok = stop_container(name)
    if ok:
        return {"status": "stopped", "name": name}
    return JSONResponse({"error": "Stop failed"}, status_code=500)


@router.post("/api/stack/container/{name}/start")
def stack_start_container(request: Request, name: str):
    _require_admin(request)
    if not _is_allowed(name):
        return JSONResponse({"error": f"Cannot start '{name}': not a managed container"}, status_code=403)
    ok = start_container(name)
    if ok:
        return {"status": "started", "name": name}
    return JSONResponse({"error": "Start failed"}, status_code=500)
