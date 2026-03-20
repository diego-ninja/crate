import logging
import os
from typing import Optional
from urllib.parse import urlencode

import requests
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response, RedirectResponse, JSONResponse

from musicdock.auth import (
    hash_password, verify_password, create_jwt, verify_jwt, JWT_EXPIRY_HOURS,
)
from musicdock.db import (
    create_user, get_user_by_email, get_user_by_google_id, get_user_by_id,
    update_user_last_login, list_users, delete_user,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE_NAME = "musicdock_session"
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


def _cookie_domain() -> str | None:
    domain = os.environ.get("DOMAIN")
    if domain:
        return f".{domain}"
    return None


def _set_auth_cookie(response: Response, token: str):
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
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
    token = create_jwt(user["id"], user["email"], user["role"])
    response = JSONResponse(content=_user_public(user))
    _set_auth_cookie(response, token)
    return response


@router.post("/register")
async def register(body: RegisterRequest):
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
    update_user_last_login(user["id"])
    token = create_jwt(user["id"], user["email"], user["role"])
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
    """Traefik forward-auth endpoint. Returns 200 with headers or 401."""
    user = getattr(request.state, "user", None)
    if not user:
        return Response(status_code=401)
    response = Response(status_code=200)
    response.headers["Remote-User"] = user["email"]
    response.headers["Remote-Role"] = user.get("role", "user")
    return response


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
            from musicdock.db import get_db_ctx
            with get_db_ctx() as cur:
                cur.execute("UPDATE users SET google_id = %s, avatar = COALESCE(avatar, %s) WHERE id = %s",
                            (google_id, avatar, user["id"]))
            user = get_user_by_id(user["id"])
        else:
            user = create_user(email=email, name=name, avatar=avatar, google_id=google_id)

    update_user_last_login(user["id"])
    token = create_jwt(user["id"], user["email"], user["role"])
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
    return _user_public(user)


@router.delete("/users/{user_id}")
async def admin_delete_user(request: Request, user_id: int):
    _require_admin(request)
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    delete_user(user_id)
    return {"ok": True}
