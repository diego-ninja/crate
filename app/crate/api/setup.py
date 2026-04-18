"""Setup wizard API — only accessible when no users exist."""

import logging

from fastapi import APIRouter, Request, HTTPException

from crate.auth import hash_password
from crate.api.auth import _require_admin
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.common import TaskEnqueueResponse
from crate.api.schemas.operations import (
    SetupAdminRequest,
    SetupAdminResponse,
    SetupCheckResponse,
    SetupKeysRequest,
    SetupKeysResponse,
    SetupStatusResponse,
)
from crate.db import count_users, create_task

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/setup", tags=["setup"])

_SETUP_PUBLIC_RESPONSES = {
    400: error_response("The request could not be processed."),
    403: error_response("Setup has already been completed or is not allowed."),
    422: error_response("The request payload failed validation."),
}

_SETUP_PRIVATE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        422: error_response("The request payload failed validation."),
    },
)


def _is_setup_needed() -> bool:
    """Check if setup is needed (no users in DB)."""
    try:
        return count_users() == 0
    except Exception:
        return True


@router.get(
    "/status",
    response_model=SetupStatusResponse,
    responses={
        200: {
            "description": "Whether the instance still needs initial setup.",
        }
    },
    summary="Check whether initial setup is still required",
)
def setup_status():
    """Check if setup is needed. No auth required."""
    return {"needs_setup": _is_setup_needed()}


@router.post(
    "/admin",
    response_model=SetupAdminResponse,
    responses=_SETUP_PUBLIC_RESPONSES,
    summary="Create the initial administrator account",
)
def setup_create_admin(body: SetupAdminRequest):
    """Create the admin user. Only works if no users exist."""
    if not _is_setup_needed():
        raise HTTPException(status_code=403, detail="Setup already completed")

    from crate.db import create_user
    user = create_user(
        email=body.email,
        name=body.name or None,
        password_hash=hash_password(body.password),
        role="admin",
    )
    return {"id": user["id"], "email": user["email"]}


@router.post(
    "/keys",
    response_model=SetupKeysResponse,
    responses=_SETUP_PRIVATE_RESPONSES,
    summary="Save external API keys during setup",
)
def setup_save_keys(request: Request, body: SetupKeysRequest):
    """Save API keys to settings. Requires admin (created in previous step)."""
    if _is_setup_needed():
        raise HTTPException(status_code=400, detail="Create admin first")

    _require_admin(request)

    from crate.db import set_setting
    keys = {
        "lastfm_apikey": body.lastfm_apikey,
        "ticketmaster_api_key": body.ticketmaster_api_key,
        "spotify_id": body.spotify_id,
        "spotify_secret": body.spotify_secret,
        "fanart_api_key": body.fanart_api_key,
        "setlistfm_api_key": body.setlistfm_api_key,
    }
    for k, v in keys.items():
        if v:
            set_setting(k, v)

    return {"saved": sum(1 for v in keys.values() if v)}


@router.post(
    "/scan",
    response_model=TaskEnqueueResponse,
    responses=_SETUP_PRIVATE_RESPONSES,
    summary="Queue the initial library pipeline",
)
def setup_start_scan(request: Request):
    """Trigger initial library scan. Requires admin."""
    if _is_setup_needed():
        raise HTTPException(status_code=400, detail="Create admin first")

    _require_admin(request)

    task_id = create_task("library_pipeline")
    return {"task_id": task_id}


@router.get(
    "/check",
    response_model=SetupCheckResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Inspect setup-related configuration status",
)
def setup_check(request: Request):
    """Check what's configured. Requires admin."""
    _require_admin(request)

    from crate.db import get_setting, get_library_stats

    stats = get_library_stats()

    return {
        "has_lastfm": bool(get_setting("lastfm_apikey")),
        "has_ticketmaster": bool(get_setting("ticketmaster_api_key")),
        "has_spotify": bool(get_setting("spotify_id")),
        "has_fanart": bool(get_setting("fanart_api_key")),
        "has_setlistfm": bool(get_setting("setlistfm_api_key")),
        "library_stats": stats,
    }
