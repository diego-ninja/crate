import logging
import os
from typing import Optional
from urllib.parse import urlencode

import requests
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response, RedirectResponse, JSONResponse

from crate.auth import (
    hash_password, verify_password, create_jwt, verify_jwt, JWT_EXPIRY_HOURS,
)
from crate.db import (
    create_user, get_user_by_email, get_user_by_google_id, get_user_by_id,
    update_user_last_login, update_user, list_users, delete_user, get_db_ctx,
    get_user_external_identity, suggest_username, upsert_user_external_identity,
    unlink_user_external_identity, create_task,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE_NAME = "crate_session"
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


def _cookie_domain() -> str | None:
    domain = os.environ.get("DOMAIN")
    if domain and domain != "localhost":
        return f".{domain}"
    return None


def _is_secure() -> bool:
    domain = os.environ.get("DOMAIN", "localhost")
    return domain != "localhost"


def _set_auth_cookie(response: Response, token: str):
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=_is_secure(),
        samesite="lax",
        domain=_cookie_domain(),
        max_age=JWT_EXPIRY_HOURS * 3600,
        path="/",
    )


def _clear_auth_cookie(response: Response):
    response.delete_cookie(
        key=COOKIE_NAME,
        httponly=True,
        secure=True,
        samesite="lax",
        domain=_cookie_domain(),
        path="/",
    )


def _user_public(user: dict) -> dict:
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "avatar": user["avatar"],
        "role": user["role"],
    }


def _google_configured() -> bool:
    return bool(os.environ.get("GOOGLE_CLIENT_ID") and os.environ.get("GOOGLE_CLIENT_SECRET"))


def _default_navidrome_username(user: dict) -> str:
    if user.get("username"):
        return str(user["username"])
    return suggest_username(user["email"])


def _schedule_navidrome_sync(user: dict, username: str | None = None) -> str:
    target_username = username or _default_navidrome_username(user)
    upsert_user_external_identity(
        user["id"],
        "navidrome",
        external_username=target_username,
        status="pending",
        last_error=None,
    )
    task_id = create_task(
        "sync_user_navidrome",
        {"user_id": user["id"], "username": target_username},
    )
    upsert_user_external_identity(
        user["id"],
        "navidrome",
        external_username=target_username,
        status="pending",
        last_task_id=task_id,
        last_error=None,
    )
    return task_id


# ── Models ───────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = None


class CreateUserRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = None
    role: str = "user"


class AdminNavidromeLinkRequest(BaseModel):
    username: str
    create_if_missing: bool = False


# ── Middleware ───────────────────────────────────────────────────

class AuthMiddleware(BaseHTTPMiddleware):
    """Check JWT cookie first, then fall back to Remote-User headers."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        user = None

        token = request.cookies.get(COOKIE_NAME)
        if token:
            payload = verify_jwt(token)
            if payload:
                user = {
                    "id": payload["user_id"],
                    "email": payload["email"],
                    "role": payload.get("role", "user"),
                    "username": payload.get("username"),
                    "name": payload.get("name"),
                }

        if not user:
            remote_user = request.headers.get("Remote-User")
            if remote_user:
                groups_raw = request.headers.get("Remote-Groups", "")
                groups = [g.strip() for g in groups_raw.split(",") if g.strip()]
                user = {
                    "id": None,
                    "email": remote_user,
                    "role": "admin" if "admins" in groups else "user",
                }

        request.state.user = user
        return await call_next(request)


def _require_auth(request: Request) -> dict:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def _require_admin(request: Request) -> dict:
    user = _require_auth(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ── Routes ───────────────────────────────────────────────────────

@router.post("/login")
async def login(body: LoginRequest):
    user = get_user_by_email(body.email)
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    update_user_last_login(user["id"])
    token = create_jwt(user["id"], user["email"], user["role"], username=user.get("username"), name=user.get("name"))
    response = JSONResponse(content=_user_public(user))
    _set_auth_cookie(response, token)
    return response


@router.post("/register")
async def register(request: Request, body: RegisterRequest):
    from crate.db import get_setting
    with get_db_ctx() as cur:
        cur.execute("SELECT COUNT(*) AS cnt FROM users")
        user_count = cur.fetchone()["cnt"]
    # First user = no auth needed. After that: open registration or admin-only.
    if user_count > 0:
        open_registration = get_setting("open_registration") == "true"
        if not open_registration:
            _require_admin(request)
    existing = get_user_by_email(body.email)
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    pw_hash = hash_password(body.password)
    user = create_user(
        email=body.email,
        name=body.name,
        password_hash=pw_hash,
        role="user",
    )
    _schedule_navidrome_sync(user)
    update_user_last_login(user["id"])
    token = create_jwt(user["id"], user["email"], user["role"], username=user.get("username"), name=user.get("name"))
    response = JSONResponse(content=_user_public(user), status_code=201)
    _set_auth_cookie(response, token)
    return response


@router.post("/logout")
async def logout():
    response = JSONResponse(content={"ok": True})
    _clear_auth_cookie(response)
    return response


@router.get("/me")
async def auth_me(request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    db_user = get_user_by_id(user["id"]) if user.get("id") else None
    if db_user:
        return _user_public(db_user)
    return {"id": None, "email": user["email"], "name": None, "avatar": None, "role": user["role"]}


@router.get("/verify")
async def auth_verify(request: Request):
    """Hard verify: 401 + redirect if not authenticated (for admin, protected services)."""
    user = getattr(request.state, "user", None)
    if not user:
        domain = os.environ.get("DOMAIN", "localhost")
        original_url = request.headers.get("X-Forwarded-Uri", "/")
        original_host = request.headers.get("X-Forwarded-Host", f"admin.{domain}")
        original_proto = request.headers.get("X-Forwarded-Proto", "https")
        redirect_to = f"{original_proto}://{original_host}{original_url}"
        login_url = f"https://admin.{domain}/login?redirect={redirect_to}"
        return Response(status_code=401, headers={"Location": login_url})
    response = Response(status_code=200)
    response.headers["Remote-User"] = user["email"]
    response.headers["Remote-Name"] = user.get("name", "")
    response.headers["Remote-Role"] = user.get("role", "user")
    return response


@router.get("/verify-soft")
async def auth_verify_soft(request: Request):
    """Soft verify: always 200, injects Remote-User if authenticated (for play, search).
    This allows services with their own auth to work — but auto-logs in if MusicDock cookie exists.
    Uses username (not email) as Remote-User for Navidrome compatibility."""
    user = getattr(request.state, "user", None)
    response = Response(status_code=200)
    if user:
        linked = get_user_external_identity(user["id"], "navidrome") if user.get("id") else None
        username = (
            linked.get("external_username")
            if linked and linked.get("status") != "unlinked" and linked.get("external_username")
            else user.get("username") or user.get("email", "").split("@")[0]
        )
        response.headers["Remote-User"] = username or "unknown"
        response.headers["Remote-Name"] = user.get("name") or ""
        response.headers["Remote-Email"] = user.get("email") or ""
        response.headers["Remote-Role"] = user.get("role") or "user"
    return response


# ── Auth config (public) ───────────────────────────────────────

@router.get("/config")
async def auth_config():
    """Return available auth methods (no secrets exposed)."""
    return {
        "google": _google_configured(),
        "discogs": bool(os.environ.get("DISCOGS_CONSUMER_KEY")),
        "password": True,
    }


# ── Profile ────────────────────────────────────────────────────

class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    username: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.put("/profile")
async def update_profile(request: Request, body: UpdateProfileRequest):
    user = _require_auth(request)
    fields = {}
    if body.name is not None:
        fields["name"] = body.name
    if body.username is not None:
        fields["username"] = body.username
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    updated = update_user(user["id"], **fields)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    # Re-issue JWT with updated name
    token = create_jwt(updated["id"], updated["email"], updated["role"],
                       username=updated.get("username"), name=updated.get("name"))
    response = JSONResponse(content=_user_public(updated))
    _set_auth_cookie(response, token)
    return response


@router.post("/change-password")
async def change_password(request: Request, body: ChangePasswordRequest):
    user = _require_auth(request)
    db_user = get_user_by_id(user["id"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    if db_user.get("password_hash"):
        if not verify_password(body.current_password, db_user["password_hash"]):
            raise HTTPException(status_code=401, detail="Current password is incorrect")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    new_hash = hash_password(body.new_password)
    update_user(user["id"], password_hash=new_hash)
    return {"ok": True}


@router.post("/unlink-google")
async def unlink_google(request: Request):
    user = _require_auth(request)
    db_user = get_user_by_id(user["id"])
    if not db_user or not db_user.get("google_id"):
        raise HTTPException(status_code=400, detail="No Google account linked")
    if not db_user.get("password_hash"):
        raise HTTPException(status_code=400, detail="Set a password before unlinking Google (you would be locked out)")
    update_user(user["id"], google_id=None)
    return {"ok": True}


# ── Google OAuth ────────────────────────────────────────────────

@router.get("/google")
async def google_login(request: Request):
    if not _google_configured():
        raise HTTPException(status_code=501, detail="Google OAuth not configured")
    domain = os.environ.get("DOMAIN", "localhost")
    redirect_uri = f"https://admin.{domain}/api/auth/google/callback"
    params = {
        "client_id": os.environ["GOOGLE_CLIENT_ID"],
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "consent",
    }
    return RedirectResponse(url=f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


@router.get("/google/callback")
async def google_callback(request: Request, code: str = ""):
    if not _google_configured() or not code:
        raise HTTPException(status_code=400, detail="Invalid OAuth callback")
    domain = os.environ.get("DOMAIN", "localhost")
    redirect_uri = f"https://admin.{domain}/api/auth/google/callback"
    token_resp = requests.post(GOOGLE_TOKEN_URL, data={
        "client_id": os.environ["GOOGLE_CLIENT_ID"],
        "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
    }, timeout=10)
    if token_resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Google token exchange failed")
    access_token = token_resp.json().get("access_token")
    info_resp = requests.get(GOOGLE_USERINFO_URL, headers={
        "Authorization": f"Bearer {access_token}",
    }, timeout=10)
    if info_resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Failed to get Google user info")
    info = info_resp.json()
    google_id = info["id"]
    email = info["email"]
    name = info.get("name")
    avatar = info.get("picture")

    user = get_user_by_google_id(google_id)
    if not user:
        user = get_user_by_email(email)
        if user:
            from crate.db import get_db_ctx
            with get_db_ctx() as cur:
                cur.execute("UPDATE users SET google_id = %s, avatar = COALESCE(avatar, %s) WHERE id = %s",
                            (google_id, avatar, user["id"]))
            user = get_user_by_id(user["id"])
        else:
            user = create_user(email=email, name=name, avatar=avatar, google_id=google_id)
            _schedule_navidrome_sync(user)

    update_user_last_login(user["id"])
    token = create_jwt(user["id"], user["email"], user["role"], username=user.get("username"), name=user.get("name"))
    response = RedirectResponse(url=f"https://admin.{domain}/")
    _set_auth_cookie(response, token)
    return response


# ── Admin: user management ──────────────────────────────────────

@router.get("/users")
async def admin_list_users(request: Request):
    _require_admin(request)
    return list_users()


@router.post("/users")
async def admin_create_user(request: Request, body: CreateUserRequest):
    _require_admin(request)
    existing = get_user_by_email(body.email)
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    pw_hash = hash_password(body.password)
    user = create_user(email=body.email, name=body.name, password_hash=pw_hash, role=body.role)
    task_id = _schedule_navidrome_sync(user)
    result = _user_public(user)
    result["navidrome_task_id"] = task_id
    return result


@router.delete("/users/{user_id}")
async def admin_delete_user(request: Request, user_id: int):
    _require_admin(request)
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    delete_user(user_id)
    return {"ok": True}


@router.get("/navidrome/users")
async def admin_list_navidrome_users(request: Request):
    _require_admin(request)
    from crate import navidrome

    try:
        users = navidrome.get_users()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Navidrome unavailable: {exc}") from exc

    return [
        {
            "username": user.get("username") or user.get("userName") or "",
            "email": user.get("email") or "",
            "admin_role": bool(user.get("adminRole")),
        }
        for user in users
        if user.get("username") or user.get("userName")
    ]


@router.get("/users/{user_id}/sync")
async def admin_user_sync_status(request: Request, user_id: int):
    _require_admin(request)
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    from crate import navidrome

    identity = get_user_external_identity(user_id, "navidrome")
    return {
        "user_id": user_id,
        "navidrome_connected": navidrome.ping(),
        "navidrome": identity or {
            "provider": "navidrome",
            "status": "unlinked",
            "external_username": None,
            "last_error": None,
            "last_task_id": None,
            "last_synced_at": None,
        },
    }


@router.post("/users/{user_id}/navidrome-link")
async def admin_link_navidrome_user(request: Request, user_id: int, body: AdminNavidromeLinkRequest):
    _require_admin(request)
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=422, detail="Username is required")

    if body.create_if_missing:
        task_id = _schedule_navidrome_sync(user, username=username)
        return {"task_id": task_id, "identity": get_user_external_identity(user_id, "navidrome")}

    from datetime import datetime, timezone
    from crate import navidrome

    nd_user = navidrome.get_user(username)
    if not nd_user:
        raise HTTPException(status_code=404, detail="Navidrome user not found")

    identity = upsert_user_external_identity(
        user_id,
        "navidrome",
        external_username=username,
        external_user_id=str(nd_user.get("id") or ""),
        status="synced",
        last_error=None,
        last_task_id=None,
        last_synced_at=datetime.now(timezone.utc).isoformat(),
    )
    return {"ok": True, "identity": identity}


@router.post("/users/{user_id}/navidrome-unlink")
async def admin_unlink_navidrome_user(request: Request, user_id: int):
    _require_admin(request)
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    unlink_user_external_identity(user_id, "navidrome")
    return {"ok": True}
