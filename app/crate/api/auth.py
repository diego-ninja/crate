import logging
import os
import hashlib
import base64
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlencode

import jwt
import psycopg2
import requests
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response, RedirectResponse, JSONResponse

from crate.auth import (
    hash_password, verify_password, create_jwt, verify_jwt, JWT_EXPIRY_HOURS,
)
from crate.db import (
    create_user, get_user_by_email, get_user_by_id,
    get_user_by_external_identity, update_user_last_login, update_user, list_users, delete_user, get_db_ctx,
    get_user_external_identity, upsert_user_external_identity, list_user_external_identities,
    unlink_user_external_identity, create_session, list_sessions, touch_session, revoke_session,
    revoke_other_sessions, get_session, get_setting, set_setting,
    create_auth_invite, list_auth_invites, consume_auth_invite,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])
admin_router = APIRouter(prefix="/api/admin/auth", tags=["admin-auth"])

COOKIE_NAME = "crate_session"
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


def _set_auth_cookie(response: Response, token: str):
    # SameSite=None allows cross-origin requests (Capacitor native app).
    # Requires Secure=True always.
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        domain=_cookie_domain(),
        max_age=JWT_EXPIRY_HOURS * 3600,
        path="/",
    )


def _clear_auth_cookie(response: Response):
    response.delete_cookie(
        key=COOKIE_NAME,
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
    base_origin = None
    if request is not None:
        origin = request.headers.get("origin")
        if origin and origin.startswith(("http://", "https://")):
            base_origin = origin.rstrip("/")
        referer = request.headers.get("referer")
        if not base_origin and referer and referer.startswith(("http://", "https://")):
            parts = referer.split("/", 3)
            base_origin = "/".join(parts[:3])
        forwarded_proto = request.headers.get("x-forwarded-proto")
        forwarded_host = request.headers.get("x-forwarded-host")
        if not base_origin and forwarded_proto and forwarded_host:
            base_origin = f"{forwarded_proto}://{forwarded_host}"
    if not base_origin:
        scheme = "http" if domain == "localhost" else "https"
        base_origin = f"{scheme}://admin.{domain}" if domain != "localhost" else "http://localhost:5173"
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


def _callback_origin(return_to: str | None = None) -> str:
    if return_to and return_to.startswith(("http://", "https://")):
        parts = return_to.split("/", 3)
        return "/".join(parts[:3])
    domain = os.environ.get("DOMAIN", "localhost")
    if domain == "localhost":
        return "http://localhost:5173"
    return f"https://admin.{domain}"


def _oauth_callback_url(provider: str, return_to: str | None = None) -> str:
    return f"{_callback_origin(return_to)}/api/auth/oauth/{provider}/callback"


def _build_oauth_state(*, provider: str, return_to: str | None, mode: str, user_id: int | None, invite_token: str | None) -> str:
    verifier = secrets.token_urlsafe(48)
    payload = {
        "provider": provider,
        "return_to": return_to,
        "mode": mode,
        "user_id": user_id,
        "invite_token": invite_token,
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


# ── Models ───────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = None
    invite_token: str | None = None


class CreateUserRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = None
    role: str = "user"


class OAuthStartRequest(BaseModel):
    return_to: str | None = None
    invite_token: str | None = None


class ProviderToggleRequest(BaseModel):
    enabled: bool


class AuthConfigUpdateRequest(BaseModel):
    invite_only: bool


class HeartbeatRequest(BaseModel):
    app_id: str | None = None
    device_label: str | None = None


class AuthInviteRequest(BaseModel):
    email: str | None = None
    expires_in_hours: int = 168
    max_uses: int | None = 1


# ── Middleware ───────────────────────────────────────────────────

class AuthMiddleware(BaseHTTPMiddleware):
    """Check JWT cookie first, then fall back to Remote-User headers."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        user = None

        # 1. Cookie auth (web browsers)
        token = request.cookies.get(COOKIE_NAME)
        # 2. Bearer token auth (Capacitor native app)
        if not token:
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header[7:]
        # 3. Query param token (audio/image streams where headers can't be set)
        if not token:
            token = request.query_params.get("token")

        if token:
            payload = verify_jwt(token)
            if payload:
                session_id = payload.get("sid")
                session = get_session(session_id) if session_id else None
                if session_id and (
                    not session
                    or session.get("revoked_at") is not None
                    or (session.get("expires_at") and session["expires_at"] <= datetime.now(timezone.utc))
                ):
                    payload = None
                if payload and session_id:
                    touch_session(
                        session_id,
                        last_seen_ip=request.client.host if request.client else None,
                        user_agent=request.headers.get("user-agent"),
                        app_id=request.headers.get("x-crate-app"),
                        device_label=request.headers.get("x-device-label"),
                    )
            if payload:
                user = {
                    "id": payload["user_id"],
                    "email": payload["email"],
                    "role": payload.get("role", "user"),
                    "username": payload.get("username"),
                    "name": payload.get("name"),
                    "session_id": payload.get("sid"),
                }

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

@router.post("/login")
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
    _set_auth_cookie(response, token)
    return response


@router.post("/register")
async def register(request: Request, body: RegisterRequest):
    with get_db_ctx() as cur:
        cur.execute("SELECT COUNT(*) AS cnt FROM users")
        user_count = cur.fetchone()["cnt"]
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
    _set_auth_cookie(response, token)
    return response


@router.post("/logout")
async def logout(request: Request):
    user = getattr(request.state, "user", None)
    if user and user.get("session_id"):
        revoke_session(user["session_id"])
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

@router.get("/config")
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


@router.get("/providers")
async def auth_providers(request: Request):
    return _provider_status(request)


@router.get("/sessions")
async def auth_sessions(request: Request):
    user = _require_auth(request)
    return list_sessions(user["id"], include_revoked=False)


@router.post("/heartbeat")
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


@router.delete("/sessions/{session_id}")
async def auth_revoke_session(request: Request, session_id: str):
    user = _require_auth(request)
    sessions = {session["id"] for session in list_sessions(user["id"], include_revoked=True)}
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    revoke_session(session_id)
    response = JSONResponse({"ok": True})
    if user.get("session_id") == session_id:
        _clear_auth_cookie(response)
    return response


@router.post("/sessions/revoke-all")
async def auth_revoke_all_sessions(request: Request):
    user = _require_auth(request)
    revoked = revoke_other_sessions(user["id"], user.get("session_id"))
    return {"ok": True, "revoked": revoked}


# ── Profile ────────────────────────────────────────────────────

class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    username: Optional[str] = None
    bio: Optional[str] = None


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
    if body.bio is not None:
        fields["bio"] = body.bio
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        updated = update_user(user["id"], **fields)
    except psycopg2.IntegrityError as exc:
        if "users_username_key" in str(exc):
            raise HTTPException(status_code=409, detail="Username is already taken") from exc
        raise
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    # Re-issue JWT with updated name
    token = create_jwt(updated["id"], updated["email"], updated["role"],
                       username=updated.get("username"), name=updated.get("name"), session_id=user.get("session_id"))
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


@router.post("/subsonic-token")
async def generate_subsonic_token(request: Request):
    """Generate or regenerate a Subsonic API token for the current user."""
    user = _require_auth(request)
    token = secrets.token_hex(16)
    update_user(user["id"], subsonic_token=token)
    return {"subsonic_token": token}


@router.delete("/subsonic-token")
async def delete_subsonic_token(request: Request):
    """Remove the Subsonic API token for the current user."""
    user = _require_auth(request)
    update_user(user["id"], subsonic_token=None)
    return {"ok": True}


@router.get("/subsonic-token")
async def get_subsonic_token(request: Request):
    """Get the current Subsonic API token (if set)."""
    user = _require_auth(request)
    db_user = get_user_by_id(user["id"])
    return {"subsonic_token": db_user.get("subsonic_token") if db_user else None}


@router.post("/oauth/{provider}/start")
async def oauth_start(request: Request, provider: str, body: OAuthStartRequest):
    provider = provider.lower()
    if provider not in {"google", "apple"}:
        raise HTTPException(status_code=404, detail="Unknown auth provider")
    if not _provider_available(provider):
        raise HTTPException(status_code=403, detail=f"{provider.title()} login is unavailable")

    user = getattr(request.state, "user", None)
    mode = "link" if user else "login"
    state = _build_oauth_state(
        provider=provider,
        return_to=body.return_to,
        mode=mode,
        user_id=user["id"] if user and mode == "link" else None,
        invite_token=body.invite_token,
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
        response = RedirectResponse(url=parsed_state.get("return_to") or "/profile")
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
    token, _ = _create_login_session(user, request)
    response = RedirectResponse(url=parsed_state.get("return_to") or "/")
    _set_auth_cookie(response, token)
    return response


@router.post("/oauth/{provider}/unlink")
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


@router.post("/oauth/{provider}/link")
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

@router.get("/users")
async def admin_list_users(request: Request):
    _require_admin(request)
    return list_users()


@admin_router.get("/providers")
async def admin_get_auth_providers(request: Request):
    _require_admin(request)
    return _provider_status(request)


@admin_router.get("/config")
async def admin_get_auth_config(request: Request):
    _require_admin(request)
    return {
        "invite_only": get_setting("auth_invite_only", "false") == "true",
    }


@admin_router.put("/config")
async def admin_update_auth_config(request: Request, body: AuthConfigUpdateRequest):
    _require_admin(request)
    set_setting("auth_invite_only", "true" if body.invite_only else "false")
    return {
        "invite_only": body.invite_only,
    }


@admin_router.put("/providers/{provider}")
async def admin_toggle_auth_provider(request: Request, provider: str, body: ProviderToggleRequest):
    _require_admin(request)
    if provider not in {"password", "google", "apple"}:
        raise HTTPException(status_code=404, detail="Unknown auth provider")
    set_setting(f"auth_{provider}_enabled", "true" if body.enabled else "false")
    return _provider_status(request)[provider]


@admin_router.post("/invites")
async def admin_create_auth_invite(request: Request, body: AuthInviteRequest):
    user = _require_admin(request)
    invite = create_auth_invite(
        user.get("id"),
        email=body.email,
        expires_in_hours=body.expires_in_hours,
        max_uses=body.max_uses,
    )
    return invite


@admin_router.get("/invites")
async def admin_list_auth_invites(request: Request):
    _require_admin(request)
    return list_auth_invites()


@router.post("/users")
async def admin_create_user(request: Request, body: CreateUserRequest):
    _require_admin(request)
    existing = get_user_by_email(body.email)
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    pw_hash = hash_password(body.password)
    user = create_user(email=body.email, name=body.name, password_hash=pw_hash, role=body.role)
    return _user_public(user)


@router.get("/users/{user_id}")
async def admin_get_user_detail(request: Request, user_id: int):
    _require_admin(request)
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    payload = _user_public(user)
    payload["username"] = user.get("username")
    payload["bio"] = user.get("bio")
    payload["created_at"] = user.get("created_at")
    payload["last_login"] = user.get("last_login")
    payload["connected_accounts"] = list_user_external_identities(user_id)
    payload["sessions"] = list_sessions(user_id, include_revoked=True)
    return payload


@router.get("/users/{user_id}/sessions")
async def admin_get_user_sessions(request: Request, user_id: int):
    _require_admin(request)
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return list_sessions(user_id, include_revoked=True)


@router.delete("/users/{user_id}/sessions/{session_id}")
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


@router.post("/users/{user_id}/sessions/revoke-all")
async def admin_revoke_all_user_sessions(request: Request, user_id: int):
    _require_admin(request)
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    revoked = revoke_other_sessions(user_id, None)
    return {"ok": True, "revoked": revoked}


@router.delete("/users/{user_id}")
async def admin_delete_user(request: Request, user_id: int):
    _require_admin(request)
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    delete_user(user_id)
    return {"ok": True}
