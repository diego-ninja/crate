"""Setup wizard API — only accessible when no users exist."""

import logging

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from crate.db import count_users, create_task

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/setup", tags=["setup"])


def _is_setup_needed() -> bool:
    """Check if setup is needed (no users in DB)."""
    try:
        return count_users() == 0
    except Exception:
        return True


@router.get("/status")
def setup_status():
    """Check if setup is needed. No auth required."""
    return {"needs_setup": _is_setup_needed()}


class SetupAdminRequest(BaseModel):
    email: str
    password: str
    name: str = ""


@router.post("/admin")
def setup_create_admin(body: SetupAdminRequest):
    """Create the admin user. Only works if no users exist."""
    if not _is_setup_needed():
        raise HTTPException(status_code=403, detail="Setup already completed")

    from crate.db import create_user
    user_id = create_user(body.email, body.password, name=body.name, role="admin")
    return {"id": user_id, "email": body.email}


class SetupKeysRequest(BaseModel):
    lastfm_apikey: str = ""
    ticketmaster_api_key: str = ""
    spotify_id: str = ""
    spotify_secret: str = ""
    fanart_api_key: str = ""
    setlistfm_api_key: str = ""


@router.post("/keys")
def setup_save_keys(request: Request, body: SetupKeysRequest):
    """Save API keys to settings. Requires admin (created in previous step)."""
    if _is_setup_needed():
        raise HTTPException(status_code=400, detail="Create admin first")

    from crate.api.auth import _require_admin
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


@router.post("/scan")
def setup_start_scan(request: Request):
    """Trigger initial library scan. Requires admin."""
    if _is_setup_needed():
        raise HTTPException(status_code=400, detail="Create admin first")

    from crate.api.auth import _require_admin
    _require_admin(request)

    task_id = create_task("library_pipeline")
    return {"task_id": task_id}


@router.get("/check")
def setup_check(request: Request):
    """Check what's configured. Requires admin."""
    from crate.api.auth import _require_admin
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
