"""Music Paths — acoustic route planning API."""

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from crate.api.auth import _require_auth
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES

router = APIRouter()


# ── Schemas ────────────────────────────────────────────────────────


class PathEndpoint(BaseModel):
    type: str = Field(description="track | album | artist | genre")
    value: str = Field(description="ID (track/album/artist) or slug (genre)")


class PathWaypoint(BaseModel):
    type: str
    value: str


class CreatePathRequest(BaseModel):
    name: str | None = None
    origin: PathEndpoint
    destination: PathEndpoint
    waypoints: list[PathWaypoint] = Field(default_factory=list)
    step_count: int = Field(default=20, ge=5, le=100)


class PreviewPathRequest(BaseModel):
    origin: PathEndpoint
    destination: PathEndpoint
    waypoints: list[PathWaypoint] = Field(default_factory=list)
    step_count: int = Field(default=20, ge=5, le=100)


# ── Endpoints ──────────────────────────────────────────────────────


@router.post(
    "/api/paths",
    responses=AUTH_ERROR_RESPONSES,
    summary="Create and compute a music path",
)
def api_create_path(request: Request, body: CreatePathRequest):
    user = _require_auth(request)
    from crate.db.paths import create_music_path, resolve_endpoint_label

    name = body.name
    if not name:
        origin_label = resolve_endpoint_label(body.origin.type, body.origin.value)
        dest_label = resolve_endpoint_label(body.destination.type, body.destination.value)
        name = f"{origin_label} → {dest_label}"

    result = create_music_path(
        user_id=user["id"],
        name=name,
        origin_type=body.origin.type,
        origin_value=body.origin.value,
        dest_type=body.destination.type,
        dest_value=body.destination.value,
        waypoints=[wp.model_dump() for wp in body.waypoints],
        step_count=body.step_count,
    )
    if not result:
        return JSONResponse(
            {"error": "Could not compute path — endpoints may lack bliss vectors"},
            status_code=422,
        )
    return result


@router.get(
    "/api/paths",
    responses=AUTH_ERROR_RESPONSES,
    summary="List user's music paths",
)
def api_list_paths(request: Request):
    user = _require_auth(request)
    from crate.db.paths import list_music_paths
    return list_music_paths(user["id"])


@router.get(
    "/api/paths/{path_id}",
    responses=AUTH_ERROR_RESPONSES,
    summary="Get a music path with tracks",
)
def api_get_path(request: Request, path_id: int):
    user = _require_auth(request)
    from crate.db.paths import get_music_path
    result = get_music_path(path_id, user["id"])
    if not result:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return result


@router.delete(
    "/api/paths/{path_id}",
    responses=AUTH_ERROR_RESPONSES,
    summary="Delete a music path",
)
def api_delete_path(request: Request, path_id: int):
    user = _require_auth(request)
    from crate.db.paths import delete_music_path
    if delete_music_path(path_id, user["id"]):
        return {"status": "deleted"}
    return JSONResponse({"error": "Not found"}, status_code=404)


@router.post(
    "/api/paths/{path_id}/regenerate",
    responses=AUTH_ERROR_RESPONSES,
    summary="Recompute a path with fresh tracks",
)
def api_regenerate_path(request: Request, path_id: int):
    user = _require_auth(request)
    from crate.db.paths import regenerate_music_path
    result = regenerate_music_path(path_id, user["id"])
    if not result:
        return JSONResponse({"error": "Not found or computation failed"}, status_code=404)
    return result


@router.post(
    "/api/paths/preview",
    responses=AUTH_ERROR_RESPONSES,
    summary="Preview a path without saving",
)
def api_preview_path(request: Request, body: PreviewPathRequest):
    _require_auth(request)
    from crate.db.paths import preview_music_path
    result = preview_music_path(
        origin_type=body.origin.type,
        origin_value=body.origin.value,
        dest_type=body.destination.type,
        dest_value=body.destination.value,
        waypoints=[wp.model_dump() for wp in body.waypoints],
        step_count=body.step_count,
    )
    if not result:
        return JSONResponse(
            {"error": "Could not compute path — endpoints may lack bliss vectors"},
            status_code=422,
        )
    return result
