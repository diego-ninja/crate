import logging
import os
import hashlib
import base64
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import jwt
import requests
from sqlalchemy.exc import IntegrityError as SAIntegrityError
from fastapi import APIRouter, Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response, RedirectResponse, JSONResponse

from crate.auth import (
    hash_password, verify_password, create_jwt, verify_jwt, JWT_EXPIRY_HOURS,
)
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES, error_response, merge_responses
from crate.api.schemas.auth import (
    AdminAuthConfigResponse,
    AdminUserDetailResponse,
    AdminUserSummaryResponse,
    AuthConfigResponse,
    AuthConfigUpdateRequest,
    AuthInviteRequest,
    AuthInviteResponse,
    AuthLoginResponse,
    AuthMeResponse,
    AuthProviderResponse,
    AuthProvidersResponse,
    AuthSessionResponse,
    AuthUserPublicResponse,
    ChangePasswordRequest,
    CreateUserRequest,
    HeartbeatRequest,
    LoginRequest,
    OAuthStartRequest,
    OAuthStartResponse,
    ProviderToggleRequest,
    RegisterRequest,
    RevokeSessionsResponse,
    SubsonicTokenResponse,
    UpdateProfileRequest,
)
from crate.api.schemas.common import OkResponse
from crate.db import (
    count_users, create_user, get_user_by_email, get_user_by_id,
    get_user_by_external_identity, update_user_last_login, update_user, list_users, delete_user,
    get_user_external_identity, upsert_user_external_identity, list_user_external_identities,
    unlink_user_external_identity, create_session, list_sessions, touch_session, revoke_session,
    revoke_other_sessions, get_session, get_setting, set_setting,
    create_auth_invite, list_auth_invites, consume_auth_invite, get_user_presence,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])
admin_router = APIRouter(prefix="/api/admin/auth", tags=["admin-auth"])

COOKIE_NAME = "crate_session"
COOKIE_NAME_LISTEN = "crate_session_listen"


def _cookie_name_for_request(request) -> str:
    """Return the appropriate cookie name based on the app making the request."""
    app_header = (request.headers.get("x-crate-app") or "").lower()
    if app_header in ("listen", "listen-web", "listen-mobile"):
        return COOKIE_NAME_LISTEN
    # Check referer/origin for listen subdomain
    origin = request.headers.get("origin", "") or request.headers.get("referer", "")
    if "listen." in origin:
        return COOKIE_NAME_LISTEN
    return COOKIE_NAME
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
APPLE_AUTH_URL = "https://appleid.apple.com/auth/authorize"
APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"
APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"


def _cookie_domain() -> str | None:
    domain = os.environ.get("DOMAIN")
    if domain and domain != "localhost":
        return f".{domain}"
    return None


def _is_secure() -> bool:
    domain = os.environ.get("DOMAIN", "localhost")
    return domain != "localhost"


def _set_auth_cookie(response: Response, token: str, cookie_name: str = COOKIE_NAME):
    response.set_cookie(
        key=cookie_name,
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        domain=_cookie_domain(),
        max_age=JWT_EXPIRY_HOURS * 3600,
        path="/",
    )


def _clear_auth_cookie(response: Response, cookie_name: str = COOKIE_NAME):
    response.delete_cookie(
        key=cookie_name,
        httponly=True,
        secure=True,
        samesite="none",
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


def _apple_configured() -> bool:
    return bool(
        os.environ.get("APPLE_CLIENT_ID")
        and os.environ.get("APPLE_TEAM_ID")
        and os.environ.get("APPLE_KEY_ID")
        and os.environ.get("APPLE_PRIVATE_KEY")
    )


def _provider_enabled(provider: str, *, default: bool = True) -> bool:
    value = get_setting(f"auth_{provider}_enabled")
    if value is None:
        return default
    return value.lower() == "true"


def _password_enabled() -> bool:
    return _provider_enabled("password", default=True)


def _provider_status(request: Request | None = None) -> dict[str, dict]:
    domain = os.environ.get("DOMAIN", "localhost")
    if request is not None:
        base_origin = str(request.base_url).rstrip("/")
    else:
        scheme = "http" if domain == "localhost" else "https"
        host = os.environ.get("API_HOST")
        if host:
            base_origin = f"{scheme}://{host}"
        elif domain == "localhost":
            base_origin = "http://localhost:8585"
        else:
            base_origin = f"{scheme}://api.{domain}"
    return {
        "password": {
            "enabled": _password_enabled(),
            "configured": True,
            "login_url": None,
        },
        "google": {
            "enabled": _provider_enabled("google", default=True),
            "configured": _google_configured(),
            "login_url": f"{base_origin}/api/auth/google",
        },
        "apple": {
            "enabled": _provider_enabled("apple", default=True),
            "configured": _apple_configured(),
            "login_url": f"{base_origin}/api/auth/apple",
        },
    }


def _provider_available(provider: str) -> bool:
    status = _provider_status()
    item = status.get(provider)
    return bool(item and item["enabled"] and item["configured"])


def _allowed_redirect_origins() -> set[str]:
    domain = os.environ.get("DOMAIN", "localhost")
    origins = set()
    if domain == "localhost":
        origins.update({"http://localhost:5173", "http://localhost:5174"})
    else:
        origins.update({
            f"https://admin.{domain}",
            f"https://listen.{domain}",
        })
    dev_domain = os.environ.get("DEV_DOMAIN")
    if dev_domain:
        origins.update({
            f"https://admin.{dev_domain}",
            f"https://listen.{dev_domain}",
        })
    return origins


def _callback_origin(return_to: str | None = None) -> str:
    allowed = _allowed_redirect_origins()
    if return_to and return_to.startswith("cratemusic://"):
        # Native OAuth — callback still goes through our web server.
        # Fall through to default origin.
        pass
    elif return_to and return_to.startswith(("http://", "https://")):
        parts = return_to.split("/", 3)
        origin = "/".join(parts[:3])
        if origin in allowed:
            return origin
    domain = os.environ.get("DOMAIN", "localhost")
    if domain == "localhost":
        return "http://localhost:5173"
    return f"https://admin.{domain}"


def _validate_return_to(return_to: str | None) -> str:
    """Validate return_to against allowed origins. Returns safe URL or fallback."""
    if not return_to:
        return "/"
    if return_to.startswith("cratemusic://"):
        return return_to
    if return_to.startswith("/") and not return_to.startswith("//"):
        return return_to
    if return_to.startswith(("http://", "https://")):
        parts = return_to.split("/", 3)
        origin = "/".join(parts[:3])
        if origin in _allowed_redirect_origins():
            return return_to
    return "/"


def _oauth_callback_url(provider: str, return_to: str | None = None) -> str:
    return f"{_callback_origin(return_to)}/api/auth/oauth/{provider}/callback"


def _append_query_param(url: str, key: str, value: str) -> str:
    parsed = urlparse(url)
    params = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k != key]
    params.append((key, value))
    return urlunparse(parsed._replace(query=urlencode(params)))


def _post_auth_redirect_url(return_to: str, token: str) -> str:
    parsed = urlparse(return_to)
    if parsed.path == "/auth/callback":
        return _append_query_param(return_to, "token", token)
    return return_to


def _build_oauth_state(*, provider: str, return_to: str | None, mode: str, user_id: int | None, invite_token: str | None, app_id: str | None = None) -> str:
    verifier = secrets.token_urlsafe(48)
    payload = {
        "provider": provider,
        "return_to": return_to,
        "mode": mode,
        "user_id": user_id,
        "invite_token": invite_token,
        "app_id": app_id,
        "verifier": verifier,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
    }
    token = jwt.encode(payload, os.environ.get("JWT_SECRET") or get_setting("jwt_secret") or "crate-oauth-state", algorithm="HS256")
    return token


def _parse_oauth_state(state: str) -> dict:
    secret = os.environ.get("JWT_SECRET") or get_setting("jwt_secret") or "crate-oauth-state"
    try:
        return jwt.decode(state, secret, algorithms=["HS256"])
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=400, detail="Invalid OAuth state") from exc


def _pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _build_apple_client_secret() -> str:
    now = datetime.now(timezone.utc)
    team_id = os.environ["APPLE_TEAM_ID"]
    client_id = os.environ["APPLE_CLIENT_ID"]
    key_id = os.environ["APPLE_KEY_ID"]
    private_key = os.environ["APPLE_PRIVATE_KEY"].replace("\\n", "\n")
    return jwt.encode(
        {
            "iss": team_id,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(days=180)).timestamp()),
            "aud": "https://appleid.apple.com",
            "sub": client_id,
        },
        private_key,
        algorithm="ES256",
        headers={"kid": key_id},
    )


def _create_login_session(user: dict, request: Request, *, app_id: str | None = None) -> tuple[str, dict]:
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS)).isoformat()
    session_id = secrets.token_urlsafe(24)
    session = create_session(
        session_id,
        user["id"],
        expires_at,
        last_seen_ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        app_id=app_id or request.headers.get("x-crate-app"),
        device_label=request.headers.get("x-device-label"),
    )
    token = create_jwt(
        user["id"],
        user["email"],
        user["role"],
        username=user.get("username"),
        name=user.get("name"),
        session_id=session_id,
    )
    return token, session


def _resolve_provider_subject(provider: str, payload: dict) -> tuple[str, str, str | None, str | None]:
    if provider == "google":
        return payload["id"], payload["email"], payload.get("name"), payload.get("picture")
    if provider == "apple":
        return payload["sub"], payload.get("email") or "", payload.get("name"), None
    raise HTTPException(status_code=400, detail="Unsupported provider")


def _iso_datetime(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


_AUTH_PUBLIC_RESPONSES = merge_responses(
    {
        400: error_response("The request could not be processed."),
        401: error_response("Authentication failed or the credentials were invalid."),
        403: error_response("This authentication flow is disabled or requires additional access."),
        404: error_response("The requested auth resource could not be found."),
        409: error_response("The request conflicts with the current authentication state."),
        422: error_response("The request payload failed validation."),
    }
)

_AUTH_PRIVATE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested auth resource could not be found."),
        409: error_response("The request conflicts with the current authentication state."),
        422: error_response("The request payload failed validation."),
    },
)

_AUTH_ADMIN_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested auth resource could not be found."),
        409: error_response("The request conflicts with the current authentication state."),
        422: error_response("The request payload failed validation."),
    },
)


# ── Middleware ───────────────────────────────────────────────────


def _should_skip_session_touch(path: str) -> bool:
    if path.startswith(("/api/stream/", "/api/download/")):
        return True
    if path.startswith("/api/tracks/") and path.endswith(("/stream", "/download")):
        return True
    if path.startswith("/api/tracks/by-storage/") and path.endswith(("/stream", "/download")):
        return True
    if path.startswith("/api/albums/") and path.endswith("/download"):
        return True
    return False

class AuthMiddleware(BaseHTTPMiddleware):
    """Resolve auth via Bearer header, query param, or cookie (in that order).

    Falls back to Remote-User headers from trusted reverse proxy.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        user = None

        # 1. Bearer token auth (primary for all clients)
        token = None
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
        # 2. Query param token (audio/image streams where headers can't be set)
        if not token:
            token = request.query_params.get("token")
        # 3. Cookie auth — try app-specific cookie first, then default
        if not token:
            token = request.cookies.get(_cookie_name_for_request(request))
        if not token:
            token = request.cookies.get(COOKIE_NAME)

        if token:
            payload = verify_jwt(token)
            if payload:
                from crate.api.auth_cache import get_cached_session, get_cached_user, should_touch_session
                session_id = payload.get("sid")
                request_path = request.url.path
                session = get_cached_session(session_id) if session_id else None
                if session_id and (
                    not session
                    or session.get("revoked_at") is not None
                    or (session.get("expires_at") and session["expires_at"] <= datetime.now(timezone.utc))
                ):
                    payload = None
                if payload and session_id and not _should_skip_session_touch(request_path) and should_touch_session(session_id):
                    touch_session(
                        session_id,
                        last_seen_ip=request.client.host if request.client else None,
                        user_agent=request.headers.get("user-agent"),
                        app_id=request.headers.get("x-crate-app"),
                        device_label=request.headers.get("x-device-label"),
                    )
            if payload:
                current_user = get_cached_user(payload["user_id"])
                if current_user:
                    user = {
                        "id": current_user["id"],
                        "email": current_user["email"],
                        "role": current_user.get("role", "user"),
                        "username": current_user.get("username"),
                        "name": current_user.get("name"),
                        "session_id": payload.get("sid"),
                    }
                else:
                    user = None

        if not user:
            # Only trust Remote-User from reverse proxy (Traefik).
            # Validate the request comes from a Docker network peer, not external.
            client_ip = request.client.host if request.client else ""
            is_trusted_proxy = client_ip.startswith("172.") or client_ip.startswith("10.") or client_ip == "127.0.0.1"
            remote_user = request.headers.get("Remote-User") if is_trusted_proxy else None
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

@router.post(
    "/login",
    response_model=AuthLoginResponse,
    responses=_AUTH_PUBLIC_RESPONSES,
    summary="Log in with email and password",
)
async def login(request: Request, body: LoginRequest):
    if not _password_enabled():
        raise HTTPException(status_code=403, detail="Password login is disabled")
    user = get_user_by_email(body.email)
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    update_user_last_login(user["id"])
    token, session = _create_login_session(user, request)
    body = {**_user_public(user), "token": token}
    body["session"] = {"id": session["id"], "expires_at": _iso_datetime(session["expires_at"])}
    response = JSONResponse(content=body)
    _set_auth_cookie(response, token, _cookie_name_for_request(request))
    return response


@router.post(
    "/register",
    response_model=AuthLoginResponse,
    responses=_AUTH_PUBLIC_RESPONSES,
    status_code=201,
    summary="Register a new user account",
)
async def register(request: Request, body: RegisterRequest):
    user_count = count_users()
    # First user = no auth needed. After that: open registration or admin-only.
    if user_count > 0:
        open_registration = get_setting("open_registration") == "true"
        if not open_registration:
            _require_admin(request)
    if get_setting("auth_invite_only", "false") == "true":
        if not body.invite_token:
            raise HTTPException(status_code=403, detail="Invite token required")
        if not consume_auth_invite(body.invite_token):
            raise HTTPException(status_code=403, detail="Invite token invalid or expired")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
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
    token, _ = _create_login_session(user, request)
    response = JSONResponse(content={**_user_public(user), "token": token}, status_code=201)
    _set_auth_cookie(response, token, _cookie_name_for_request(request))
    return response


@router.post(
    "/logout",
    response_model=OkResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Log out the current session",
)
async def logout(request: Request):
    user = getattr(request.state, "user", None)
    if user and user.get("session_id"):
        revoke_session(user["session_id"])
        from crate.api.auth_cache import invalidate_session
        invalidate_session(user["session_id"])
    response = JSONResponse(content={"ok": True})
    _clear_auth_cookie(response, _cookie_name_for_request(request))
    return response


@router.get(
    "/me",
    response_model=AuthMeResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the authenticated user profile",
)
async def auth_me(request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    db_user = get_user_by_id(user["id"]) if user.get("id") else None
    if db_user:
        payload = _user_public(db_user)
        payload["username"] = db_user.get("username")
        payload["bio"] = db_user.get("bio")
        payload["session_id"] = user.get("session_id")
        payload["connected_accounts"] = list_user_external_identities(user["id"])
        return payload
    return {"id": None, "email": user["email"], "name": None, "avatar": None, "role": user["role"]}


@router.get("/verify")
async def auth_verify(request: Request):
    """Hard verify: 401 + redirect if not authenticated (for admin, protected services)."""
    user = getattr(request.state, "user", None)
    if not user:
        domain = os.environ.get("DOMAIN", "localhost")
        # Validate X-Forwarded-Host against allowed domains to prevent open redirect
        allowed_hosts = {f"admin.{domain}", f"listen.{domain}", domain}
        original_host = request.headers.get("X-Forwarded-Host", f"admin.{domain}")
        if original_host not in allowed_hosts:
            original_host = f"admin.{domain}"
        original_url = request.headers.get("X-Forwarded-Uri", "/")
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
    """Soft verify: always 200 and injects identity headers if authenticated."""
    user = getattr(request.state, "user", None)
    response = Response(status_code=200)
    if user:
        response.headers["Remote-User"] = user.get("username") or user.get("email") or "unknown"
        response.headers["Remote-Name"] = user.get("name") or ""
        response.headers["Remote-Email"] = user.get("email") or ""
        response.headers["Remote-Role"] = user.get("role") or "user"
    return response


# ── Auth config (public) ───────────────────────────────────────

@router.get(
    "/config",
    response_model=AuthConfigResponse,
    summary="Get public authentication configuration",
)
async def auth_config(request: Request):
    """Return available auth methods (no secrets exposed)."""
    providers = _provider_status(request)
    return {
        "google": providers["google"]["enabled"] and providers["google"]["configured"],
        "apple": providers["apple"]["enabled"] and providers["apple"]["configured"],
        "discogs": False,
        "password": providers["password"]["enabled"],
        "invite_only": get_setting("auth_invite_only", "false") == "true",
    }


@router.get(
    "/providers",
    response_model=AuthProvidersResponse,
    summary="List configured authentication providers",
)
async def auth_providers(request: Request):
    return _provider_status(request)


@router.get(
    "/sessions",
    response_model=list[AuthSessionResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List active sessions for the current user",
)
async def auth_sessions(request: Request):
    user = _require_auth(request)
    return list_sessions(user["id"], include_revoked=False)


@router.post(
    "/heartbeat",
    response_model=OkResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Refresh the current session heartbeat",
)
async def auth_heartbeat(request: Request, body: HeartbeatRequest):
    user = _require_auth(request)
    if user.get("session_id"):
        touch_session(
            user["session_id"],
            last_seen_ip=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            app_id=body.app_id or request.headers.get("x-crate-app"),
            device_label=body.device_label or request.headers.get("x-device-label"),
        )
    return {"ok": True}


@router.delete(
    "/sessions/{session_id}",
    response_model=OkResponse,
    responses=_AUTH_PRIVATE_RESPONSES,
    summary="Revoke one of the current user's sessions",
)
async def auth_revoke_session(request: Request, session_id: str):
    user = _require_auth(request)
    sessions = {session["id"] for session in list_sessions(user["id"], include_revoked=True)}
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    revoke_session(session_id)
    response = JSONResponse({"ok": True})
    if user.get("session_id") == session_id:
        _clear_auth_cookie(response, _cookie_name_for_request(request))
    return response


@router.post(
    "/sessions/revoke-all",
    response_model=RevokeSessionsResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Revoke all other sessions for the current user",
)
async def auth_revoke_all_sessions(request: Request):
    user = _require_auth(request)
    revoked = revoke_other_sessions(user["id"], user.get("session_id"))
    return {"ok": True, "revoked": revoked}


# ── Profile ────────────────────────────────────────────────────


@router.put(
    "/profile",
    response_model=AuthUserPublicResponse,
    responses=_AUTH_PRIVATE_RESPONSES,
    summary="Update the authenticated user's profile",
)
async def update_profile(request: Request, body: UpdateProfileRequest):
    user = _require_auth(request)
    fields = {}
    if body.name is not None:
        fields["name"] = body.name
    if body.username is not None:
        fields["username"] = body.username
    if body.bio is not None:
        fields["bio"] = body.bio
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        updated = update_user(user["id"], **fields)
    except SAIntegrityError as exc:
        if "users_username_key" in str(exc):
            raise HTTPException(status_code=409, detail="Username is already taken") from exc
        raise
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    # Re-issue JWT with updated name
    token = create_jwt(updated["id"], updated["email"], updated["role"],
                       username=updated.get("username"), name=updated.get("name"), session_id=user.get("session_id"))
    response = JSONResponse(content=_user_public(updated))
    _set_auth_cookie(response, token, _cookie_name_for_request(request))
    return response


@router.post(
    "/change-password",
    response_model=OkResponse,
    responses=_AUTH_PRIVATE_RESPONSES,
    summary="Change the authenticated user's password",
)
async def change_password(request: Request, body: ChangePasswordRequest):
    user = _require_auth(request)
    db_user = get_user_by_id(user["id"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    if db_user.get("password_hash"):
        if not verify_password(body.current_password, db_user["password_hash"]):
            raise HTTPException(status_code=401, detail="Current password is incorrect")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    new_hash = hash_password(body.new_password)
    update_user(user["id"], password_hash=new_hash)
    return {"ok": True}


@router.post(
    "/subsonic-token",
    response_model=SubsonicTokenResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Generate or rotate the Subsonic token",
)
async def generate_subsonic_token(request: Request):
    """Generate or regenerate a Subsonic API token for the current user."""
    user = _require_auth(request)
    token = secrets.token_hex(16)
    update_user(user["id"], subsonic_token=token)
    return {"subsonic_token": token}


@router.delete(
    "/subsonic-token",
    response_model=OkResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Delete the Subsonic token",
)
async def delete_subsonic_token(request: Request):
    """Remove the Subsonic API token for the current user."""
    user = _require_auth(request)
    update_user(user["id"], subsonic_token=None)
    return {"ok": True}


@router.get(
    "/subsonic-token",
    response_model=SubsonicTokenResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the current Subsonic token",
)
async def get_subsonic_token(request: Request):
    """Get the current Subsonic API token (if set)."""
    user = _require_auth(request)
    db_user = get_user_by_id(user["id"])
    return {"subsonic_token": db_user.get("subsonic_token") if db_user else None}


@router.post(
    "/oauth/{provider}/start",
    response_model=OAuthStartResponse,
    responses=_AUTH_PUBLIC_RESPONSES,
    summary="Start an OAuth login or link flow",
)
async def oauth_start(request: Request, provider: str, body: OAuthStartRequest):
    provider = provider.lower()
    if provider not in {"google", "apple"}:
        raise HTTPException(status_code=404, detail="Unknown auth provider")
    if not _provider_available(provider):
        raise HTTPException(status_code=403, detail=f"{provider.title()} login is unavailable")

    user = getattr(request.state, "user", None)
    mode = "link" if user else "login"
    app_id = request.headers.get("x-crate-app") or request.query_params.get("app_id")
    state = _build_oauth_state(
        provider=provider,
        return_to=body.return_to,
        mode=mode,
        user_id=user["id"] if user and mode == "link" else None,
        invite_token=body.invite_token,
        app_id=app_id,
    )
    parsed_state = _parse_oauth_state(state)
    verifier = parsed_state["verifier"]
    common_params = {
        "redirect_uri": _oauth_callback_url(provider, body.return_to),
        "response_type": "code",
        "state": state,
        "code_challenge": _pkce_challenge(verifier),
        "code_challenge_method": "S256",
    }
    if provider == "google":
        params = {
            **common_params,
            "client_id": os.environ["GOOGLE_CLIENT_ID"],
            "scope": "openid email profile",
            "access_type": "offline",
            "prompt": "consent",
        }
        login_url = f"{GOOGLE_AUTH_URL}?{urlencode(params)}"
    else:
        params = {
            **common_params,
            "client_id": os.environ["APPLE_CLIENT_ID"],
            "scope": "name email",
            "response_mode": "query",
        }
        login_url = f"{APPLE_AUTH_URL}?{urlencode(params)}"
    return {"provider": provider, "login_url": login_url}


def _google_userinfo(code: str, redirect_uri: str, verifier: str) -> dict:
    token_resp = requests.post(
        GOOGLE_TOKEN_URL,
        data={
            "client_id": os.environ["GOOGLE_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
            "code_verifier": verifier,
        },
        timeout=10,
    )
    if token_resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Google token exchange failed")
    access_token = token_resp.json().get("access_token")
    info_resp = requests.get(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=10,
    )
    if info_resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Failed to get Google user info")
    return info_resp.json()


def _apple_userinfo(code: str, redirect_uri: str, verifier: str) -> dict:
    token_resp = requests.post(
        APPLE_TOKEN_URL,
        data={
            "client_id": os.environ["APPLE_CLIENT_ID"],
            "client_secret": _build_apple_client_secret(),
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
            "code_verifier": verifier,
        },
        timeout=10,
    )
    if token_resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Apple token exchange failed")
    id_token = token_resp.json().get("id_token")
    if not id_token:
        raise HTTPException(status_code=401, detail="Apple did not return id_token")
    keys_resp = requests.get(APPLE_KEYS_URL, timeout=10)
    keys_resp.raise_for_status()
    header = jwt.get_unverified_header(id_token)
    jwk = next((key for key in keys_resp.json().get("keys", []) if key.get("kid") == header.get("kid")), None)
    if not jwk:
        raise HTTPException(status_code=401, detail="Unable to validate Apple token")
    public_key = jwt.algorithms.RSAAlgorithm.from_jwk(jwk)
    payload = jwt.decode(
        id_token,
        public_key,
        algorithms=["RS256"],
        audience=os.environ["APPLE_CLIENT_ID"],
        issuer="https://appleid.apple.com",
    )
    return payload


@router.get("/oauth/{provider}/callback")
async def oauth_callback(request: Request, provider: str, code: str = "", state: str = ""):
    provider = provider.lower()
    if provider not in {"google", "apple"}:
        raise HTTPException(status_code=404, detail="Unknown auth provider")
    if not code or not state:
        raise HTTPException(status_code=400, detail="Invalid OAuth callback")
    parsed_state = _parse_oauth_state(state)
    if parsed_state.get("provider") != provider:
        raise HTTPException(status_code=400, detail="OAuth provider mismatch")
    redirect_uri = _oauth_callback_url(provider, parsed_state.get("return_to"))
    verifier = parsed_state["verifier"]
    external_payload = _google_userinfo(code, redirect_uri, verifier) if provider == "google" else _apple_userinfo(code, redirect_uri, verifier)
    external_user_id, email, name, avatar = _resolve_provider_subject(provider, external_payload)
    user = get_user_by_external_identity(provider, external_user_id)
    # Always sync avatar from OAuth provider
    if user and avatar:
        update_user(user["id"], avatar=avatar)
        user = get_user_by_id(user["id"])
    if parsed_state.get("mode") == "link":
        target_user_id = parsed_state.get("user_id")
        if not target_user_id:
            raise HTTPException(status_code=400, detail="Missing user for account linking")
        user = get_user_by_id(int(target_user_id))
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        upsert_user_external_identity(
            user["id"],
            provider,
            external_user_id=external_user_id,
            external_username=email,
            status="linked",
            last_error=None,
            metadata={"email": email},
        )
        redirect_to = _validate_return_to(parsed_state.get("return_to"))
        response = RedirectResponse(url=redirect_to)
        return response

    if not user:
        if email:
            user = get_user_by_email(email)
        if user:
            upsert_user_external_identity(
                user["id"],
                provider,
                external_user_id=external_user_id,
                external_username=email,
                status="linked",
                last_error=None,
                metadata={"email": email},
            )
            if provider == "google" and not user.get("google_id"):
                update_user(user["id"], google_id=external_user_id)
            if avatar:
                update_user(user["id"], avatar=avatar)
            user = get_user_by_id(user["id"])
        else:
            if get_setting("auth_invite_only", "false") == "true":
                invite_token = parsed_state.get("invite_token")
                if not invite_token or not consume_auth_invite(invite_token):
                    raise HTTPException(status_code=403, detail="Invite token required")
            user = create_user(email=email, name=name, avatar=avatar, google_id=external_user_id if provider == "google" else None)
            upsert_user_external_identity(
                user["id"],
                provider,
                external_user_id=external_user_id,
                external_username=email,
                status="linked",
                last_error=None,
                metadata={"email": email},
            )

    update_user_last_login(user["id"])
    app_id = parsed_state.get("app_id")
    token, _ = _create_login_session(user, request, app_id=app_id)

    return_to = parsed_state.get("return_to") or "/"
    safe_return = _validate_return_to(return_to)

    if safe_return.startswith("cratemusic://"):
        separator = "&" if "?" in safe_return else "?"
        redirect_url = f"{safe_return}{separator}token={token}"
        return RedirectResponse(url=redirect_url)

    if safe_return.startswith("http"):
        response = RedirectResponse(url=_post_auth_redirect_url(safe_return, token))
        _set_auth_cookie(response, token, _cookie_name_for_request(request))
        return response

    response = RedirectResponse(url=_post_auth_redirect_url(safe_return, token))
    _set_auth_cookie(response, token, _cookie_name_for_request(request))
    return response


@router.post(
    "/oauth/{provider}/unlink",
    response_model=OkResponse,
    responses=_AUTH_PRIVATE_RESPONSES,
    summary="Unlink an OAuth provider from the current account",
)
async def oauth_unlink(request: Request, provider: str):
    user = _require_auth(request)
    db_user = get_user_by_id(user["id"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    identity = get_user_external_identity(user["id"], provider)
    if not identity or identity.get("status") == "unlinked":
        raise HTTPException(status_code=400, detail=f"No {provider.title()} account linked")
    if not db_user.get("password_hash") and len(list_user_external_identities(user["id"])) <= 1:
        raise HTTPException(status_code=400, detail="Set a password or link another provider before unlinking this account")
    unlink_user_external_identity(user["id"], provider)
    if provider == "google" and db_user.get("google_id"):
        update_user(user["id"], google_id=None)
    return {"ok": True}


@router.post(
    "/oauth/{provider}/link",
    response_model=OAuthStartResponse,
    responses=_AUTH_PRIVATE_RESPONSES,
    summary="Start linking an OAuth provider to the current account",
)
async def oauth_link(request: Request, provider: str, body: OAuthStartRequest):
    _require_auth(request)
    return await oauth_start(request, provider, body)


@router.post("/unlink-google")
async def unlink_google(request: Request):
    return await oauth_unlink(request, "google")


@router.get("/google")
async def google_login(request: Request, return_to: str | None = None):
    payload = await oauth_start(request, "google", OAuthStartRequest(return_to=return_to))
    return RedirectResponse(url=payload["login_url"])


@router.get("/google/callback")
async def google_callback(request: Request, code: str = "", state: str = ""):
    return await oauth_callback(request, "google", code=code, state=state)


@router.get("/apple")
async def apple_login(request: Request, return_to: str | None = None):
    payload = await oauth_start(request, "apple", OAuthStartRequest(return_to=return_to))
    return RedirectResponse(url=payload["login_url"])


@router.get("/apple/callback")
async def apple_callback(request: Request, code: str = "", state: str = ""):
    return await oauth_callback(request, "apple", code=code, state=state)


# ── Admin: user management ──────────────────────────────────────

@router.get(
    "/users",
    response_model=list[AdminUserSummaryResponse],
    responses=_AUTH_ADMIN_RESPONSES,
    summary="List users for administration",
)
async def admin_list_users(request: Request):
    _require_admin(request)
    return list_users()


@admin_router.get(
    "/providers",
    response_model=AuthProvidersResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="List provider configuration for administrators",
)
async def admin_get_auth_providers(request: Request):
    _require_admin(request)
    return _provider_status(request)


@admin_router.get(
    "/config",
    response_model=AdminAuthConfigResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="Get admin-only authentication settings",
)
async def admin_get_auth_config(request: Request):
    _require_admin(request)
    return {
        "invite_only": get_setting("auth_invite_only", "false") == "true",
    }


@admin_router.put(
    "/config",
    response_model=AdminAuthConfigResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="Update admin-only authentication settings",
)
async def admin_update_auth_config(request: Request, body: AuthConfigUpdateRequest):
    _require_admin(request)
    set_setting("auth_invite_only", "true" if body.invite_only else "false")
    return {
        "invite_only": body.invite_only,
    }


@admin_router.put(
    "/providers/{provider}",
    response_model=AuthProviderResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="Enable or disable an authentication provider",
)
async def admin_toggle_auth_provider(request: Request, provider: str, body: ProviderToggleRequest):
    _require_admin(request)
    if provider not in {"password", "google", "apple"}:
        raise HTTPException(status_code=404, detail="Unknown auth provider")
    set_setting(f"auth_{provider}_enabled", "true" if body.enabled else "false")
    return _provider_status(request)[provider]


@admin_router.post(
    "/invites",
    response_model=AuthInviteResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="Create an authentication invite",
)
async def admin_create_auth_invite(request: Request, body: AuthInviteRequest):
    user = _require_admin(request)
    invite = create_auth_invite(
        user.get("id"),
        email=body.email,
        expires_in_hours=body.expires_in_hours,
        max_uses=body.max_uses,
    )
    return invite


@admin_router.get(
    "/invites",
    response_model=list[AuthInviteResponse],
    responses=_AUTH_ADMIN_RESPONSES,
    summary="List authentication invites",
)
async def admin_list_auth_invites(request: Request):
    _require_admin(request)
    return list_auth_invites()


@router.post(
    "/users",
    response_model=AuthUserPublicResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="Create a user as an administrator",
)
async def admin_create_user(request: Request, body: CreateUserRequest):
    _require_admin(request)
    existing = get_user_by_email(body.email)
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    pw_hash = hash_password(body.password)
    user = create_user(email=body.email, name=body.name, password_hash=pw_hash, role=body.role)
    return _user_public(user)


@router.get(
    "/users/{user_id}",
    response_model=AdminUserDetailResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="Get a user with sessions and linked accounts",
)
async def admin_get_user_detail(request: Request, user_id: int):
    _require_admin(request)
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    payload = _user_public(user)
    payload["username"] = user.get("username")
    payload["bio"] = user.get("bio")
    payload["created_at"] = _iso_datetime(user.get("created_at"))
    payload["last_login"] = _iso_datetime(user.get("last_login"))
    payload["connected_accounts"] = list_user_external_identities(user_id)
    payload["sessions"] = list_sessions(user_id, include_revoked=True)
    payload.update(get_user_presence(user_id))
    return payload


@router.get(
    "/users/{user_id}/sessions",
    response_model=list[AuthSessionResponse],
    responses=_AUTH_ADMIN_RESPONSES,
    summary="List sessions for a user",
)
async def admin_get_user_sessions(request: Request, user_id: int):
    _require_admin(request)
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return list_sessions(user_id, include_revoked=True)


@router.delete(
    "/users/{user_id}/sessions/{session_id}",
    response_model=OkResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="Revoke a specific user session",
)
async def admin_revoke_user_session(request: Request, user_id: int, session_id: str):
    _require_admin(request)
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    sessions = {session["id"] for session in list_sessions(user_id, include_revoked=True)}
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    revoke_session(session_id)
    return {"ok": True}


@router.post(
    "/users/{user_id}/sessions/revoke-all",
    response_model=RevokeSessionsResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="Revoke all sessions for a user",
)
async def admin_revoke_all_user_sessions(request: Request, user_id: int):
    _require_admin(request)
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    revoked = revoke_other_sessions(user_id, None)
    return {"ok": True, "revoked": revoked}


@router.delete(
    "/users/{user_id}",
    response_model=OkResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="Delete a user",
)
async def admin_delete_user(request: Request, user_id: int):
    _require_admin(request)
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    delete_user(user_id)
    return {"ok": True}
