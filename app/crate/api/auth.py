import base64
import hashlib
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from threading import RLock
from typing import Literal, overload
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import jwt
import requests
from fastapi import APIRouter, HTTPException, Request
from sqlalchemy.exc import IntegrityError as SAIntegrityError
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse, RedirectResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.permissions import (
    ALL_CAPABILITIES,
    ROLE_CAPABILITIES,
    get_user_capabilities,
    require_permission,
    validate_roles,
)
from crate.api.schemas.auth import (
    AdminAuthConfigResponse,
    AdminSetPasswordRequest,
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
    AuthRefreshResponse,
    AuthSessionResponse,
    AuthUserPublicResponse,
    ChangePasswordRequest,
    CreateUserRequest,
    HeartbeatRequest,
    LoginRequest,
    NativeOAuthExchangeRequest,
    OAuthStartRequest,
    OAuthStartResponse,
    ProviderToggleRequest,
    RefreshTokenRequest,
    RegisterRequest,
    RevokeSessionsResponse,
    SubsonicTokenResponse,
    UpdateProfileRequest,
    UpdateUserRoleRequest,
    UpdateUserStatusRequest,
)
from crate.api.native_oauth import (
    InvalidNativeOAuthHandoff,
    NativeOAuthUnavailable,
    consume_handoff as consume_native_oauth_handoff,
    issue_handoff as issue_native_oauth_handoff,
)
from crate.api.schemas.common import OkResponse
from crate.auth import (
    JWT_EXPIRY_HOURS,
    LISTEN_ACCESS_TOKEN_EXPIRY_HOURS,
    LISTEN_REFRESH_TOKEN_EXPIRY_DAYS,
    create_jwt,
    create_refresh_jwt,
    hash_password,
    verify_jwt,
    verify_password,
    verify_refresh_jwt,
)
from crate.db.audit import log_audit
from crate.db.cache_settings import get_setting, set_setting
from crate.db.queries.auth_user_activity import derive_user_activity
from crate.db.repositories.auth import (
    consume_auth_invite,
    count_users,
    create_auth_invite,
    create_session,
    create_user,
    get_session,
    get_user_by_email,
    get_user_by_external_identity,
    get_user_by_google_id,
    get_user_by_id,
    get_user_external_identity,
    get_user_presence,
    list_auth_invites,
    list_sessions,
    list_user_external_identities,
    list_users,
    revoke_other_sessions,
    revoke_session,
    set_user_roles,
    touch_session,
    unlink_user_external_identity,
    update_user,
    update_user_last_login,
    update_user_status,
    upsert_user_external_identity,
)
from crate.db.repositories.library_contributions import list_user_album_contributions
from crate.db.repositories.tasks import create_task

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])
admin_router = APIRouter(prefix="/api/admin/auth", tags=["admin-auth"])

COOKIE_NAME = "crate_session"
COOKIE_NAME_LISTEN = "crate_session_listen"
COOKIE_NAME_LISTEN_REFRESH = "crate_refresh_listen"
FORWARD_AUTH_SECRET_HEADER = "X-Forward-Auth-Secret"
_LOGIN_FAILURE_PREFIX = "crate:auth:login_failures"
_OAUTH_INVITE_PREFIX = "crate:auth:oauth_invite"
_OAUTH_INVITE_TTL_SECONDS = 900
_login_failure_memory: dict[str, tuple[int, datetime]] = {}
_oauth_invite_memory: dict[str, tuple[str, datetime]] = {}
_login_failure_lock = RLock()
_oauth_invite_lock = RLock()


def _parse_allowed_email_domains() -> list[str]:
    raw = os.environ.get("CRATE_ALLOWED_EMAIL_DOMAINS") or os.environ.get(
        "ALLOWED_EMAIL_DOMAINS", ""
    )
    return [d.strip().lower() for d in raw.split(",") if d.strip()]


def _validate_email_domain(email: str) -> None:
    """Raise 403 if email domain is not in the optional allowlist."""
    allowed = _parse_allowed_email_domains()
    if not allowed:
        return
    domain = email.split("@")[-1].lower()
    if domain not in allowed:
        raise HTTPException(
            status_code=403,
            detail=f"Email domain @{domain} is not authorized for this instance.",
        )


def _login_rate_limit_enabled() -> bool:
    return os.environ.get("CRATE_LOGIN_RATE_LIMIT_ENABLED", "1").lower() not in {
        "0",
        "false",
        "no",
    }


def _login_rate_limit_max_attempts() -> int:
    try:
        return max(1, int(os.environ.get("CRATE_LOGIN_RATE_LIMIT_MAX_ATTEMPTS", "5")))
    except ValueError:
        return 5


def _login_rate_limit_window_seconds() -> int:
    try:
        return max(
            60, int(os.environ.get("CRATE_LOGIN_RATE_LIMIT_WINDOW_SECONDS", "900"))
        )
    except ValueError:
        return 900


def _client_ip(request: Request) -> str:
    forwarded_for = (
        (request.headers.get("x-forwarded-for") or "").split(",", 1)[0].strip()
    )
    if forwarded_for:
        return forwarded_for
    return request.client.host if request.client else "unknown"


def _rate_limit_key(kind: str, value: str) -> str:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
    return f"{_LOGIN_FAILURE_PREFIX}:{kind}:{digest}"


def _login_rate_limit_keys(email: str, request: Request) -> list[str]:
    normalized_email = (email or "").strip().lower() or "unknown"
    keys = [_rate_limit_key("email", normalized_email)]
    ip = _client_ip(request)
    if ip and ip != "unknown":
        keys.append(_rate_limit_key("ip", ip))
    return keys


def _get_rate_limit_redis():
    if not os.environ.get("REDIS_URL"):
        return None
    try:
        from crate.db.cache_runtime import get_redis

        return get_redis()
    except Exception as exc:
        log.warning("Login rate limiter could not use Redis: %s", exc)
        return None


def _memory_failure_count(key: str, now: datetime, window_seconds: int) -> int:
    count, expires_at = _login_failure_memory.get(key, (0, now))
    if expires_at <= now:
        _login_failure_memory.pop(key, None)
        return 0
    return count


def _enforce_login_rate_limit(email: str, request: Request) -> None:
    if not _login_rate_limit_enabled():
        return
    max_attempts = _login_rate_limit_max_attempts()
    window_seconds = _login_rate_limit_window_seconds()
    keys = _login_rate_limit_keys(email, request)
    redis_client = _get_rate_limit_redis()
    if redis_client is not None:
        for key in keys:
            try:
                if int(redis_client.get(key) or 0) >= max_attempts:
                    raise HTTPException(
                        status_code=429,
                        detail="Too many login attempts. Try again later.",
                    )
            except HTTPException:
                raise
            except Exception as exc:
                log.warning("Login rate limiter Redis read failed: %s", exc)
                break
        else:
            return

    now = datetime.now(timezone.utc)
    with _login_failure_lock:
        for key in keys:
            if _memory_failure_count(key, now, window_seconds) >= max_attempts:
                raise HTTPException(
                    status_code=429, detail="Too many login attempts. Try again later."
                )


def _record_failed_login(email: str, request: Request) -> None:
    if not _login_rate_limit_enabled():
        return
    max_attempts = _login_rate_limit_max_attempts()
    window_seconds = _login_rate_limit_window_seconds()
    keys = _login_rate_limit_keys(email, request)
    redis_client = _get_rate_limit_redis()
    if redis_client is not None:
        locked = False
        try:
            for key in keys:
                count = int(redis_client.incr(key))
                if count == 1:
                    redis_client.expire(key, window_seconds)
                locked = locked or count > max_attempts
            if locked:
                raise HTTPException(
                    status_code=429, detail="Too many login attempts. Try again later."
                )
            return
        except HTTPException:
            raise
        except Exception as exc:
            log.warning("Login rate limiter Redis write failed: %s", exc)

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=window_seconds)
    locked = False
    with _login_failure_lock:
        for key in keys:
            count = _memory_failure_count(key, now, window_seconds) + 1
            _login_failure_memory[key] = (count, expires_at)
            locked = locked or count > max_attempts
    if locked:
        raise HTTPException(
            status_code=429, detail="Too many login attempts. Try again later."
        )


def _clear_failed_login(email: str, request: Request) -> None:
    if not _login_rate_limit_enabled():
        return
    keys = _login_rate_limit_keys(email, request)
    redis_client = _get_rate_limit_redis()
    if redis_client is not None:
        try:
            redis_client.delete(*keys)
            return
        except Exception as exc:
            log.warning("Login rate limiter Redis cleanup failed: %s", exc)
    with _login_failure_lock:
        for key in keys:
            _login_failure_memory.pop(key, None)


def _reject_invalid_login(email: str, request: Request) -> None:
    _record_failed_login(email, request)
    raise HTTPException(status_code=401, detail="Invalid credentials")


def _forward_auth_secret() -> str | None:
    return os.environ.get("FORWARD_AUTH_SECRET") or os.environ.get(
        "CRATE_FORWARD_AUTH_SECRET"
    )


def _has_valid_forward_auth_secret(request: Request) -> bool:
    expected = _forward_auth_secret()
    provided = request.headers.get(FORWARD_AUTH_SECRET_HEADER)
    return bool(expected and provided and secrets.compare_digest(provided, expected))


def _is_listen_app_id(app_id: str | None) -> bool:
    return (app_id or "").strip().lower().startswith("listen")


def _is_native_listen_app_id(app_id: str | None) -> bool:
    normalized = (app_id or "").strip().lower()
    return normalized in {
        "listen-android",
        "listen-ios",
        "listen-native",
        "listen-tauri",
    }


def _is_mobile_native_listen_app_id(app_id: str | None) -> bool:
    normalized = (app_id or "").strip().lower()
    return normalized in {"listen-android", "listen-ios", "listen-native"}


def _env_enabled(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _native_oauth_exchange_enabled() -> bool:
    return _env_enabled("NATIVE_OAUTH_EXCHANGE_ENABLED", False)


def _native_oauth_legacy_redirect_enabled() -> bool:
    return _env_enabled("NATIVE_OAUTH_LEGACY_REDIRECT_ENABLED", True)


_NATIVE_CALLBACK_URL = "cratemusic://oauth/callback"
_NATIVE_CHALLENGE_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")
_NATIVE_STATE_RE = re.compile(r"^[A-Za-z0-9_-]{16,256}$")
_NATIVE_VERIFIER_RE = re.compile(r"^[A-Za-z0-9._~-]{43,128}$")


def _validate_native_oauth_start(
    *,
    app_id: str | None,
    mode: str,
    return_to: str | None,
    challenge: str | None,
    state: str | None,
) -> bool:
    requested = challenge is not None or state is not None
    if not requested:
        if (
            _is_mobile_native_listen_app_id(app_id)
            and not _native_oauth_legacy_redirect_enabled()
        ):
            raise HTTPException(
                status_code=426,
                detail="Native app upgrade required",
            )
        return False
    if not _native_oauth_exchange_enabled():
        raise HTTPException(
            status_code=503,
            detail="Native OAuth exchange is not enabled",
        )
    if mode != "login" or not _is_mobile_native_listen_app_id(app_id):
        raise HTTPException(status_code=400, detail="Invalid native OAuth client")
    if return_to != _NATIVE_CALLBACK_URL:
        raise HTTPException(status_code=400, detail="Invalid native OAuth callback")
    if not challenge or not state:
        raise HTTPException(status_code=400, detail="Incomplete native OAuth binding")
    if not _NATIVE_CHALLENGE_RE.fullmatch(challenge):
        raise HTTPException(
            status_code=400,
            detail="Invalid native OAuth code challenge",
        )
    if not _NATIVE_STATE_RE.fullmatch(state):
        raise HTTPException(status_code=400, detail="Invalid native OAuth state")
    return True


def _is_listen_return_to(return_to: str | None) -> bool:
    value = (return_to or "").strip()
    if value.startswith("cratemusic://"):
        return True
    if not value.startswith(("http://", "https://")):
        return False
    try:
        host = (urlparse(value).hostname or "").lower()
    except Exception:
        return False
    return host == "listen" or host.startswith("listen.")


def _is_tauri_loopback_return_to(return_to: str | None) -> bool:
    if not return_to:
        return False
    try:
        parsed = urlparse(return_to)
    except Exception:
        return False
    return (
        parsed.scheme == "http"
        and parsed.hostname in {"127.0.0.1", "localhost"}
        and parsed.port == 17654
        and parsed.path == "/oauth/callback"
    )


def _request_host(request: Request) -> str:
    host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or request.url.netloc
        or ""
    )
    return host.split(",", 1)[0].split(":", 1)[0].strip().lower()


def _is_listen_request(
    request: Request, *, app_id: str | None = None, return_to: str | None = None
) -> bool:
    if _is_listen_app_id(app_id) or _is_listen_app_id(
        request.headers.get("x-crate-app")
    ):
        return True
    if _is_listen_return_to(return_to):
        return True
    if _request_host(request).startswith("listen."):
        return True
    origin = request.headers.get("origin", "") or request.headers.get("referer", "")
    return "listen." in origin


def _access_expiry_hours(
    request: Request, *, app_id: str | None = None, return_to: str | None = None
) -> int:
    return (
        LISTEN_ACCESS_TOKEN_EXPIRY_HOURS
        if _is_listen_request(request, app_id=app_id, return_to=return_to)
        else JWT_EXPIRY_HOURS
    )


def _session_expiry_hours(
    request: Request, *, app_id: str | None = None, return_to: str | None = None
) -> int:
    return (
        24 * LISTEN_REFRESH_TOKEN_EXPIRY_DAYS
        if _is_listen_request(request, app_id=app_id, return_to=return_to)
        else JWT_EXPIRY_HOURS
    )


def _session_max_age_seconds(
    request: Request, *, app_id: str | None = None, return_to: str | None = None
) -> int:
    return _session_expiry_hours(request, app_id=app_id, return_to=return_to) * 3600


def _access_max_age_seconds(
    request: Request, *, app_id: str | None = None, return_to: str | None = None
) -> int:
    return _access_expiry_hours(request, app_id=app_id, return_to=return_to) * 3600


def _infer_oauth_app_id(request: Request, return_to: str | None) -> str | None:
    app_id = request.headers.get("x-crate-app") or request.query_params.get("app_id")
    if app_id:
        return app_id
    if _is_listen_return_to(return_to):
        return (
            "listen-native"
            if (return_to or "").startswith("cratemusic://")
            else "listen-web"
        )
    return None


def _cookie_name_for_request(request) -> str:
    """Return the appropriate cookie name based on the app making the request."""
    if _is_listen_request(request):
        return COOKIE_NAME_LISTEN
    return COOKIE_NAME


def _cookie_name_for_context(
    request: Request, *, app_id: str | None = None, return_to: str | None = None
) -> str:
    return (
        COOKIE_NAME_LISTEN
        if _is_listen_request(request, app_id=app_id, return_to=return_to)
        else COOKIE_NAME
    )


def _auth_cookie_candidates(request) -> tuple[str, ...]:
    preferred = _cookie_name_for_request(request)
    candidates = [preferred]
    for cookie_name in (COOKIE_NAME_LISTEN, COOKIE_NAME):
        if cookie_name not in candidates:
            candidates.append(cookie_name)
    return tuple(candidates)


GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
APPLE_AUTH_URL = "https://appleid.apple.com/auth/authorize"
APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"
APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"


def _cookie_domain() -> str | None:
    override = os.environ.get("CRATE_AUTH_COOKIE_DOMAIN")
    if override is not None:
        domain = override.strip()
        if not domain or domain in {"localhost", "127.0.0.1", "::1"}:
            return None
        return domain if domain.startswith(".") else f".{domain}"

    domain = os.environ.get("DOMAIN")
    if domain and domain != "localhost":
        return f".{domain}"
    return None


def _is_secure() -> bool:
    override = os.environ.get("CRATE_AUTH_COOKIE_SECURE")
    if override is not None:
        return override.strip().lower() in {"1", "true", "yes", "on"}

    domain = os.environ.get("DOMAIN", "localhost")
    return domain != "localhost"


def _cookie_samesite() -> Literal["lax", "strict", "none"]:
    override = os.environ.get("CRATE_AUTH_COOKIE_SAMESITE")
    if override:
        normalized = override.strip().lower()
        if normalized == "lax":
            return "lax"
        if normalized == "strict":
            return "strict"
        if normalized == "none":
            return "none"
    return "none" if _is_secure() else "lax"


def _set_auth_cookie(
    response: Response,
    token: str,
    cookie_name: str = COOKIE_NAME,
    *,
    max_age: int | None = None,
):
    response.set_cookie(
        key=cookie_name,
        value=token,
        httponly=True,
        secure=_is_secure(),
        samesite=_cookie_samesite(),
        domain=_cookie_domain(),
        max_age=max_age or JWT_EXPIRY_HOURS * 3600,
        path="/",
    )


def _set_refresh_cookie(response: Response, refresh_token: str, *, max_age: int):
    response.set_cookie(
        key=COOKIE_NAME_LISTEN_REFRESH,
        value=refresh_token,
        httponly=True,
        secure=_is_secure(),
        samesite=_cookie_samesite(),
        domain=_cookie_domain(),
        max_age=max_age,
        path="/api/auth",
    )


def _clear_auth_cookie(response: Response, cookie_name: str = COOKIE_NAME):
    response.delete_cookie(
        key=cookie_name,
        httponly=True,
        secure=_is_secure(),
        samesite=_cookie_samesite(),
        domain=_cookie_domain(),
        path="/",
    )


def _clear_refresh_cookie(response: Response):
    response.delete_cookie(
        key=COOKIE_NAME_LISTEN_REFRESH,
        httponly=True,
        secure=_is_secure(),
        samesite=_cookie_samesite(),
        domain=_cookie_domain(),
        path="/api/auth",
    )


def _clear_cookies_for_context(
    response: Response,
    request: Request,
    *,
    app_id: str | None = None,
    return_to: str | None = None,
) -> None:
    cookie_name = _cookie_name_for_context(
        request,
        app_id=app_id,
        return_to=return_to,
    )
    _clear_auth_cookie(response, cookie_name)
    if cookie_name == COOKIE_NAME_LISTEN:
        _clear_auth_cookie(response, COOKIE_NAME)
        _clear_refresh_cookie(response)


def _clean_header_value(value: str | None, *, max_length: int = 160) -> str | None:
    normalized = (value or "").strip()
    if not normalized:
        return None
    return normalized[:max_length]


def _request_device_fingerprint(
    request: Request, *, app_id: str | None = None
) -> str | None:
    explicit = _clean_header_value(
        request.headers.get("x-device-fingerprint"), max_length=128
    )
    if explicit:
        return explicit
    if not _is_listen_request(request, app_id=app_id):
        return None
    source = "|".join(
        part
        for part in (
            app_id or request.headers.get("x-crate-app") or "listen",
            request.headers.get("x-device-label") or "",
            request.headers.get("user-agent") or "",
        )
        if part
    )
    if not source:
        return None
    return f"ua:{hashlib.sha256(source.encode('utf-8')).hexdigest()[:32]}"


def _user_public(user: dict) -> dict:
    roles = validate_roles(user.get("roles") or [user.get("role")])
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "avatar": user["avatar"],
        "role": roles[0],
        "roles": roles,
    }


def _user_status(user: dict | None) -> str:
    return str((user or {}).get("status") or "active").strip().lower() or "active"


def _ensure_user_active(user: dict | None) -> dict:
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    status = _user_status(user)
    if status != "active":
        raise HTTPException(status_code=403, detail=f"User account is {status}")
    return user


def _with_capabilities(user: dict) -> dict:
    payload = dict(user)
    payload["status"] = _user_status(payload)
    roles = validate_roles(payload.get("roles") or [payload.get("role")])
    payload["role"] = roles[0]
    payload["roles"] = roles
    payload["capabilities"] = sorted(get_user_capabilities(payload))
    return payload


def _admin_capable_roles() -> set[str]:
    return {
        role
        for role in ("owner", "admin")
        if "admin.access" in get_user_capabilities({"role": role})
    }


def _is_active_admin_capable(user: dict) -> bool:
    return _user_status(user) == "active" and "admin.access" in get_user_capabilities(
        user
    )


def _ensure_role_change_is_safe(
    actor: dict, target: dict, next_roles: list[str]
) -> None:
    next_roles = validate_roles(next_roles)
    next_capabilities = get_user_capabilities({"roles": next_roles})
    if actor.get("id") == target.get("id") and "admin.access" not in next_capabilities:
        raise HTTPException(
            status_code=400, detail="Cannot remove your own admin access"
        )
    if not _is_active_admin_capable(target) or "admin.access" in next_capabilities:
        return

    remaining_admins = [
        user
        for user in list_users()
        if user.get("id") != target.get("id") and _is_active_admin_capable(user)
    ]
    if not remaining_admins:
        raise HTTPException(
            status_code=400, detail="At least one owner or admin must remain"
        )


def _ensure_status_change_is_safe(actor: dict, target: dict, next_status: str) -> None:
    current_status = _user_status(target)
    if current_status == next_status:
        return
    if actor.get("id") == target.get("id") and next_status != "active":
        raise HTTPException(status_code=400, detail="Cannot disable your own account")
    if next_status == "active" or not _is_active_admin_capable(target):
        return
    remaining_admins = [
        user
        for user in list_users()
        if user.get("id") != target.get("id") and _is_active_admin_capable(user)
    ]
    if not remaining_admins:
        raise HTTPException(
            status_code=400, detail="At least one owner or admin must remain"
        )


def _invalidate_auth_user(user_id: int) -> None:
    from crate.api.auth_cache import invalidate_user

    invalidate_user(user_id)


def _invalidate_auth_session(session_id: str) -> None:
    from crate.api.auth_cache import invalidate_session

    invalidate_session(session_id)


def _revoke_user_sessions(user_id: int, current_session_id: str | None = None) -> int:
    open_session_ids = [
        session["id"]
        for session in list_sessions(user_id, include_revoked=False, limit=None)
        if not current_session_id or session["id"] != current_session_id
    ]
    revoked = revoke_other_sessions(user_id, current_session_id)
    for session_id in open_session_ids:
        _invalidate_auth_session(session_id)
    return revoked


def _is_proxyable_avatar_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except Exception:
        return False
    if parsed.scheme != "https":
        return False
    host = (parsed.hostname or "").lower()
    return (
        host == "lh3.googleusercontent.com"
        or host.endswith(".googleusercontent.com")
        or host in {"www.gravatar.com", "secure.gravatar.com", "gravatar.com"}
    )


def _google_configured() -> bool:
    return bool(
        os.environ.get("GOOGLE_CLIENT_ID") and os.environ.get("GOOGLE_CLIENT_SECRET")
    )


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
        base_origin = _request_base_origin(request)
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


def _request_base_origin(request: Request) -> str:
    forwarded_proto = (
        (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip()
    )
    forwarded_host = (
        (request.headers.get("x-forwarded-host") or "").split(",")[0].strip()
    )
    host = forwarded_host or request.headers.get("host") or request.url.netloc
    scheme = forwarded_proto or request.url.scheme
    domain = os.environ.get("DOMAIN", "localhost")
    hostname = host.split(":", 1)[0].lower()

    if (
        scheme == "http"
        and domain != "localhost"
        and (hostname == domain or hostname.endswith(f".{domain}"))
    ):
        scheme = "https"

    return f"{scheme}://{host}".rstrip("/")


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
        origins.update(
            {
                f"https://admin.{domain}",
                f"https://listen.{domain}",
            }
        )
    dev_domain = os.environ.get("DEV_DOMAIN")
    if dev_domain:
        origins.update(
            {
                f"https://admin.{dev_domain}",
                f"https://listen.{dev_domain}",
            }
        )
    return origins


def _callback_origin(return_to: str | None = None, *, app_id: str | None = None) -> str:
    allowed = _allowed_redirect_origins()
    if return_to and (
        return_to.startswith("cratemusic://")
        or _is_tauri_loopback_return_to(return_to)
        or _is_native_listen_app_id(app_id)
    ):
        # Native/Tauri OAuth still needs an HTTPS callback registered with
        # Google/Apple. Keep it on Listen, not Admin, so desktop/mobile auth
        # does not visibly bounce through the admin surface.
        domain = os.environ.get("DOMAIN", "localhost")
        return (
            "http://localhost:5174"
            if domain == "localhost"
            else f"https://listen.{domain}"
        )
    elif return_to and return_to.startswith(("http://", "https://")):
        parts = return_to.split("/", 3)
        origin = "/".join(parts[:3])
        if origin in allowed:
            return origin
    domain = os.environ.get("DOMAIN", "localhost")
    if domain == "localhost":
        return "http://localhost:5173"
    return f"https://admin.{domain}"


def _validate_return_to(return_to: str | None, *, app_id: str | None = None) -> str:
    """Validate return_to against allowed origins. Returns safe URL or fallback."""
    if not return_to:
        return "/"
    if return_to.startswith("cratemusic://"):
        return return_to
    if app_id == "listen-tauri" and _is_tauri_loopback_return_to(return_to):
        return return_to
    if return_to.startswith("/") and not return_to.startswith("//"):
        return return_to
    if return_to.startswith(("http://", "https://")):
        parts = return_to.split("/", 3)
        origin = "/".join(parts[:3])
        if origin in _allowed_redirect_origins():
            return return_to
    return "/"


def _oauth_callback_url(
    provider: str, return_to: str | None = None, *, app_id: str | None = None
) -> str:
    return f"{_callback_origin(return_to, app_id=app_id)}/api/auth/oauth/{provider}/callback"


def _append_query_param(url: str, key: str, value: str) -> str:
    parsed = urlparse(url)
    params = [
        (k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k != key
    ]
    params.append((key, value))
    return urlunparse(parsed._replace(query=urlencode(params)))


def _post_auth_redirect_url(return_to: str, token: str) -> str:
    parsed = urlparse(return_to)
    if parsed.path in {"/auth/callback", "/oauth/callback"}:
        return _append_query_param(return_to, "token", token)
    return return_to


def _raise_oauth_identity_conflict(provider: str, exc: SAIntegrityError) -> None:
    lower = str(exc).lower()
    if (
        "google_id" in lower
        or "idx_user_external_identities" in lower
        or "user_external_identities" in lower
    ):
        raise HTTPException(
            status_code=409,
            detail=f"{provider.title()} account is already linked to another user",
        ) from exc
    raise exc


def _consume_oauth_signup_invite(
    invite_token: str | None, *, email: str | None
) -> None:
    """Require an invite or admin setup for OAuth-created accounts."""
    if count_users() <= 0:
        raise HTTPException(
            status_code=403,
            detail="No users configured yet. Set up the admin account first.",
        )

    invite_required = get_setting("auth_invite_only", "false") == "true"
    registration_open = get_setting("open_registration") == "true"
    if registration_open and not invite_required:
        return

    if not invite_token or not consume_auth_invite(invite_token, email=email):
        raise HTTPException(
            status_code=403, detail="Invite token required or does not match this email"
        )


def _consume_registration_invite(
    invite_token: str | None, *, email: str | None
) -> None:
    if not invite_token:
        raise HTTPException(status_code=403, detail="Invite token required")
    if not consume_auth_invite(invite_token, email=email):
        raise HTTPException(
            status_code=403,
            detail="Invite token invalid, expired, or does not match this email",
        )


def _request_user_is_admin(request: Request) -> bool:
    user = getattr(request.state, "user", None)
    return bool(user and user.get("role") == "admin")


def _build_oauth_state(
    *,
    provider: str,
    return_to: str | None,
    mode: str,
    user_id: int | None,
    invite_token: str | None,
    app_id: str | None = None,
    native_code_challenge: str | None = None,
    native_state: str | None = None,
) -> str:
    verifier = secrets.token_urlsafe(48)
    invite_key = None
    if invite_token:
        invite_key = secrets.token_urlsafe(32)
        _store_oauth_invite_token(invite_key, invite_token)
    payload = {
        "provider": provider,
        "return_to": return_to,
        "mode": mode,
        "user_id": user_id,
        "invite_key": invite_key,
        "app_id": app_id,
        "native_code_challenge": native_code_challenge,
        "native_state": native_state,
        "verifier": verifier,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
    }
    token = jwt.encode(
        payload,
        os.environ.get("JWT_SECRET")
        or get_setting("jwt_secret")
        or "crate-oauth-state",
        algorithm="HS256",
    )
    return token


def _store_oauth_invite_token(key: str, token: str) -> None:
    """Store an invite token server-side so it never appears in OAuth redirect URLs."""
    expires_at = datetime.now(timezone.utc) + timedelta(
        seconds=_OAUTH_INVITE_TTL_SECONDS
    )
    try:
        r = _get_rate_limit_redis()
        if r is not None:
            r.setex(f"{_OAUTH_INVITE_PREFIX}:{key}", _OAUTH_INVITE_TTL_SECONDS, token)
            return
    except Exception:
        log.warning("Failed to store OAuth invite token in Redis", exc_info=True)
    with _oauth_invite_lock:
        _oauth_invite_memory[key] = (token, expires_at)


def _retrieve_oauth_invite_token(key: str | None) -> str | None:
    """Retrieve an invite token stored server-side during OAuth flow."""
    if not key:
        return None
    try:
        r = _get_rate_limit_redis()
        if r is not None:
            token = r.get(f"{_OAUTH_INVITE_PREFIX}:{key}")
            if token:
                r.delete(f"{_OAUTH_INVITE_PREFIX}:{key}")
                if isinstance(token, bytes):
                    return token.decode("utf-8")
                return str(token)
    except Exception:
        log.warning("Failed to retrieve OAuth invite token from Redis", exc_info=True)
    with _oauth_invite_lock:
        token_record = _oauth_invite_memory.pop(key, None)
    if not token_record:
        return None
    token, expires_at = token_record
    if expires_at <= datetime.now(timezone.utc):
        return None
    return token


def _parse_oauth_state(state: str) -> dict:
    secret = (
        os.environ.get("JWT_SECRET") or get_setting("jwt_secret") or "crate-oauth-state"
    )
    try:
        return jwt.decode(state, secret, algorithms=["HS256"])
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=400, detail="Invalid OAuth state") from exc


def _pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _associated_app_ids() -> list[str]:
    configured = os.environ.get("APPLE_ASSOCIATED_APP_IDS", "")
    if configured.strip():
        return [part.strip() for part in configured.split(",") if part.strip()]
    team_id = os.environ.get("APPLE_TEAM_ID", "").strip()
    if not team_id:
        return []
    bundle_id = os.environ.get(
        "APPLE_LISTEN_BUNDLE_ID", "org.lespedants.crate.listen"
    ).strip()
    return [f"{team_id}.{bundle_id}"]


@router.get("/apple-app-site-association", include_in_schema=False)
def apple_app_site_association():
    app_ids = _associated_app_ids()
    if not app_ids:
        raise HTTPException(
            status_code=404, detail="Apple associated app id is not configured"
        )
    return JSONResponse(
        {
            "applinks": {
                "apps": [],
                "details": [
                    {
                        "appID": app_id,
                        "paths": ["/auth/callback*"],
                    }
                    for app_id in app_ids
                ],
            },
        }
    )


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


def _create_login_session(
    user: dict, request: Request, *, app_id: str | None = None
) -> tuple[str, dict, str | None]:
    user = _ensure_user_active(user)
    app = app_id or request.headers.get("x-crate-app")
    session_expiry_hours = _session_expiry_hours(request, app_id=app)
    access_expiry_hours = _access_expiry_hours(request, app_id=app)
    expires_at_dt = datetime.now(timezone.utc) + timedelta(hours=session_expiry_hours)
    expires_at = expires_at_dt.isoformat()
    session_id = secrets.token_urlsafe(24)
    session = create_session(
        session_id,
        user["id"],
        expires_at,
        last_seen_ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        app_id=app,
        device_label=request.headers.get("x-device-label"),
        device_fingerprint=_request_device_fingerprint(request, app_id=app),
    )
    session_id = session["id"]
    token = create_jwt(
        user["id"],
        user["email"],
        user["role"],
        username=user.get("username"),
        name=user.get("name"),
        session_id=session_id,
        expires_in_hours=access_expiry_hours,
    )
    refresh_token = (
        create_refresh_jwt(user["id"], session_id, expires_at_dt)
        if _is_listen_request(request, app_id=app)
        else None
    )
    return token, session, refresh_token


def _resolve_provider_subject(
    provider: str, payload: dict
) -> tuple[str, str, str | None, str | None]:
    if provider == "google":
        return (
            payload["id"],
            payload.get("email") or "",
            payload.get("name"),
            payload.get("picture"),
        )
    if provider == "apple":
        return payload["sub"], payload.get("email") or "", payload.get("name"), None
    raise HTTPException(status_code=400, detail="Unsupported provider")


@overload
def _iso_datetime(value: datetime) -> str: ...


@overload
def _iso_datetime(value: str) -> str: ...


@overload
def _iso_datetime(value: None) -> None: ...


def _iso_datetime(value: datetime | str | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _access_expires_at_from_token(token: str) -> datetime | None:
    try:
        payload = jwt.decode(
            token,
            options={"verify_signature": False, "verify_exp": False},
        )
    except Exception:
        return None
    exp = payload.get("exp")
    if isinstance(exp, datetime):
        return exp if exp.tzinfo else exp.replace(tzinfo=timezone.utc)
    if isinstance(exp, (int, float)):
        return datetime.fromtimestamp(exp, timezone.utc)
    return None


def _coerce_aware_datetime(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)


def _auth_login_payload(
    user: dict, token: str, session: dict, refresh_token: str | None = None
) -> dict:
    payload = {
        **_user_public(user),
        "token": token,
        "access_expires_at": _iso_datetime(_access_expires_at_from_token(token)),
        "refresh_token": refresh_token,
    }
    payload["session"] = {
        "id": session["id"],
        "expires_at": _iso_datetime(session.get("expires_at")),
    }
    return payload


def _set_login_cookies(
    response: Response,
    request: Request,
    token: str,
    refresh_token: str | None = None,
    *,
    app_id: str | None = None,
    return_to: str | None = None,
) -> None:
    _clear_cookies_for_context(
        response,
        request,
        app_id=app_id,
        return_to=return_to,
    )
    _set_auth_cookie(
        response,
        token,
        _cookie_name_for_context(request, app_id=app_id, return_to=return_to),
        max_age=_access_max_age_seconds(request, app_id=app_id, return_to=return_to),
    )
    if refresh_token:
        _set_refresh_cookie(
            response,
            refresh_token,
            max_age=_session_max_age_seconds(
                request, app_id=app_id, return_to=return_to
            ),
        )


_AUTH_PUBLIC_RESPONSES = merge_responses(
    {
        400: error_response("The request could not be processed."),
        401: error_response("Authentication failed or the credentials were invalid."),
        403: error_response(
            "This authentication flow is disabled or requires additional access."
        ),
        404: error_response("The requested auth resource could not be found."),
        409: error_response(
            "The request conflicts with the current authentication state."
        ),
        422: error_response("The request payload failed validation."),
    }
)

_AUTH_PRIVATE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested auth resource could not be found."),
        409: error_response(
            "The request conflicts with the current authentication state."
        ),
        422: error_response("The request payload failed validation."),
    },
)

_AUTH_ADMIN_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested auth resource could not be found."),
        409: error_response(
            "The request conflicts with the current authentication state."
        ),
        422: error_response("The request payload failed validation."),
    },
)


# ── Middleware ───────────────────────────────────────────────────


class AuthMiddleware:
    """Resolve auth via Bearer header, query param, or cookie (in that order).

    Falls back to Remote-User headers from trusted reverse proxy.
    """

    def __init__(self, app: ASGIApp):
        self.app = app

    def _resolve_session_user(
        self, user_id: int, session_id: str | None
    ) -> dict | None:
        from crate.api.auth_cache import get_cached_session, get_cached_user

        session = get_cached_session(session_id) if session_id else None
        if session_id and (
            not session
            or int(session.get("user_id") or 0) != user_id
            or session.get("revoked_at") is not None
            or (
                session.get("expires_at")
                and session["expires_at"] <= datetime.now(timezone.utc)
            )
        ):
            return None

        current_user = get_cached_user(user_id)
        if not current_user or _user_status(current_user) != "active":
            return None

        return {
            "id": current_user["id"],
            "email": current_user["email"],
            "role": current_user.get("role", "user"),
            "username": current_user.get("username"),
            "name": current_user.get("name"),
            "session_id": session_id,
        }

    def _resolve_token_user(self, token: str) -> dict | None:
        payload = verify_jwt(token)
        if not payload:
            return None
        try:
            user_id = int(payload["user_id"])
        except (KeyError, TypeError, ValueError):
            return None
        session_id = payload.get("sid")
        return self._resolve_session_user(
            user_id,
            str(session_id) if session_id else None,
        )

    async def resolve_user(self, request: Request) -> dict | None:
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
        if token:
            user = await run_in_threadpool(self._resolve_token_user, token)
        else:
            media_ticket = request.query_params.get("media_ticket")
            if media_ticket:
                from crate.media_access import (
                    media_audience_for_path,
                    validate_media_access_ticket,
                )

                audience = media_audience_for_path(request.url.path)
                validated = (
                    validate_media_access_ticket(
                        media_ticket,
                        audience=audience,
                        request_path=request.url.path,
                    )
                    if audience
                    else None
                )
                if validated:
                    user = await run_in_threadpool(
                        self._resolve_session_user,
                        validated.user_id,
                        validated.session_id,
                    )

        if not user and not token:
            for cookie_name in _auth_cookie_candidates(request):
                cookie_token = request.cookies.get(cookie_name)
                if not cookie_token:
                    continue
                user = await run_in_threadpool(self._resolve_token_user, cookie_token)
                if user:
                    break

        if not user:
            # Only trust Remote-User from a trusted reverse proxy that knows
            # the shared secret. Docker network source alone is not enough:
            # any compromised container on the network could forge headers.
            client_ip = request.client.host if request.client else ""
            is_trusted_proxy = (
                client_ip.startswith("172.")
                or client_ip.startswith("10.")
                or client_ip == "127.0.0.1"
            )
            remote_user = (
                request.headers.get("Remote-User")
                if is_trusted_proxy and _has_valid_forward_auth_secret(request)
                else None
            )
            if remote_user:
                groups_raw = request.headers.get("Remote-Groups", "")
                groups = [g.strip() for g in groups_raw.split(",") if g.strip()]
                role = (request.headers.get("Remote-Role") or "").strip().lower()
                user = {
                    "id": None,
                    "email": remote_user,
                    "role": "admin"
                    if role == "admin" or "admins" in groups
                    else "user",
                }

        return user

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive=receive)
        scope.setdefault("state", {})
        scope["state"]["user"] = await self.resolve_user(request)
        await self.app(scope, receive, send)


def _require_auth(request: Request) -> dict:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def _require_admin(request: Request) -> dict:
    return require_permission(request, "admin.access")


def _require_users_view(request: Request) -> dict:
    return require_permission(request, "users.view")


def _require_users_manage(request: Request) -> dict:
    return require_permission(request, "users.manage")


def _require_users_create(request: Request) -> dict:
    return require_permission(request, "users.create")


def _require_users_status_manage(request: Request) -> dict:
    return require_permission(request, "users.status.manage")


def _require_users_password_manage(request: Request) -> dict:
    return require_permission(request, "users.password.manage")


def _require_users_sessions_manage(request: Request) -> dict:
    return require_permission(request, "users.sessions.manage")


def _require_users_delete(request: Request) -> dict:
    return require_permission(request, "users.delete")


def _require_roles_view(request: Request) -> dict:
    return require_permission(request, "roles.view")


def _require_roles_assign(request: Request) -> dict:
    return require_permission(request, "roles.assign")


def _require_roles_manage(request: Request) -> dict:
    return require_permission(request, "roles.manage")


def _require_auth_manage(request: Request) -> dict:
    return require_permission(request, "auth.manage")


# ── Routes ───────────────────────────────────────────────────────


@router.post(
    "/login",
    response_model=AuthLoginResponse,
    responses=_AUTH_PUBLIC_RESPONSES,
    summary="Log in with email and password",
)
def login(request: Request, body: LoginRequest):
    if not _password_enabled():
        raise HTTPException(status_code=403, detail="Password login is disabled")
    _enforce_login_rate_limit(body.email, request)
    user = get_user_by_email(body.email)
    password_hash = user.get("password_hash") if user else None
    if not user or not password_hash:
        _reject_invalid_login(body.email, request)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    _ensure_user_active(user)
    if not verify_password(body.password, str(password_hash)):
        _reject_invalid_login(body.email, request)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    _clear_failed_login(body.email, request)
    update_user_last_login(user["id"])
    token, session, refresh_token = _create_login_session(user, request)
    response = JSONResponse(
        content=_auth_login_payload(user, token, session, refresh_token)
    )
    _set_login_cookies(response, request, token, refresh_token)
    return response


@router.post(
    "/register",
    response_model=AuthLoginResponse,
    responses=_AUTH_PUBLIC_RESPONSES,
    status_code=201,
    summary="Register a new user account",
)
def register(request: Request, body: RegisterRequest):
    rate_key = f"register:{body.email}"
    _enforce_login_rate_limit(rate_key, request)
    try:
        invite_token_to_consume: str | None = None
        user_count = count_users()
        if user_count > 0:
            open_registration = get_setting("open_registration") == "true"
            invite_only = get_setting("auth_invite_only", "false") == "true"
            is_admin = _request_user_is_admin(request)
            if not open_registration and not is_admin:
                invite_token_to_consume = body.invite_token
            elif open_registration and invite_only:
                invite_token_to_consume = body.invite_token
        if len(body.password) < 8:
            raise HTTPException(
                status_code=400, detail="Password must be at least 8 characters"
            )
        _validate_email_domain(body.email)
        existing = get_user_by_email(body.email)
        if existing:
            raise HTTPException(status_code=409, detail="Email already registered")
        if invite_token_to_consume is not None:
            _consume_registration_invite(invite_token_to_consume, email=body.email)
        pw_hash = hash_password(body.password)
        user = create_user(
            email=body.email,
            name=body.name,
            password_hash=pw_hash,
            role="user",
        )
        update_user_last_login(user["id"])
        token, session, refresh_token = _create_login_session(user, request)
    except HTTPException:
        _record_failed_login(rate_key, request)
        raise

    _clear_failed_login(rate_key, request)
    response = JSONResponse(
        content=_auth_login_payload(user, token, session, refresh_token),
        status_code=201,
    )
    _set_login_cookies(response, request, token, refresh_token)
    return response


@router.post(
    "/refresh",
    response_model=AuthRefreshResponse,
    responses=_AUTH_PUBLIC_RESPONSES,
    summary="Refresh a Listen access token",
)
def refresh_auth(request: Request, body: RefreshTokenRequest | None = None):
    refresh_token = (body.refresh_token if body else None) or request.cookies.get(
        COOKIE_NAME_LISTEN_REFRESH
    )
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Refresh token required")

    payload = verify_refresh_jwt(refresh_token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    session_id = payload.get("sid")
    user_id = payload.get("user_id")
    if not isinstance(user_id, (str, int)):
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    try:
        user_id_int = int(user_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid refresh token") from None
    session = get_session(session_id) if session_id else None
    if not session or session.get("revoked_at") is not None:
        raise HTTPException(
            status_code=401, detail="Refresh session is no longer valid"
        )
    if int(session.get("user_id") or 0) != user_id_int:
        raise HTTPException(status_code=401, detail="Refresh token session mismatch")

    expires_at = _coerce_aware_datetime(session.get("expires_at"))
    now = datetime.now(timezone.utc)
    if expires_at is None or expires_at <= now:
        raise HTTPException(status_code=401, detail="Refresh session expired")

    user = get_user_by_id(user_id_int)
    if not user:
        raise HTTPException(status_code=401, detail="Refresh user no longer exists")
    _ensure_user_active(user)

    session_app_id = session.get("app_id")
    refreshed = (
        touch_session(
            session["id"],
            last_seen_ip=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            app_id=session_app_id or request.headers.get("x-crate-app"),
            device_label=request.headers.get("x-device-label")
            or session.get("device_label"),
            device_fingerprint=_request_device_fingerprint(
                request, app_id=session_app_id
            )
            or session.get("device_fingerprint"),
        )
        or session
    )
    access_token = create_jwt(
        user["id"],
        user["email"],
        user["role"],
        username=user.get("username"),
        name=user.get("name"),
        session_id=refreshed["id"],
        expires_in_hours=_access_expiry_hours(request, app_id=session_app_id),
    )
    next_refresh_token = create_refresh_jwt(user["id"], refreshed["id"], expires_at)
    access_expires_at = _access_expires_at_from_token(access_token)
    response = JSONResponse(
        content={
            "token": access_token,
            "access_expires_at": _iso_datetime(access_expires_at),
            "refresh_token": next_refresh_token,
            "session": {
                "id": refreshed["id"],
                "expires_at": _iso_datetime(refreshed.get("expires_at")),
            },
        }
    )
    _clear_cookies_for_context(response, request, app_id=session_app_id)
    _set_auth_cookie(
        response,
        access_token,
        _cookie_name_for_context(request, app_id=session_app_id),
        max_age=_access_max_age_seconds(request, app_id=session_app_id),
    )
    if _is_listen_request(request, app_id=session_app_id):
        _set_refresh_cookie(
            response,
            next_refresh_token,
            max_age=max(1, int((expires_at - now).total_seconds())),
        )
    return response


@router.post(
    "/logout",
    response_model=OkResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Log out the current session",
)
def logout(request: Request):
    user = getattr(request.state, "user", None)
    if user and user.get("session_id"):
        revoke_session(user["session_id"])
        from crate.api.auth_cache import invalidate_session

        invalidate_session(user["session_id"])
    response = JSONResponse(content={"ok": True})
    _clear_cookies_for_context(response, request)
    return response


@router.get(
    "/me",
    response_model=AuthMeResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the authenticated user profile",
)
def auth_me(request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    db_user = get_user_by_id(user["id"]) if user.get("id") else None
    if db_user:
        payload = _user_public(db_user)
        payload["username"] = db_user.get("username")
        payload["bio"] = db_user.get("bio")
        payload["session_id"] = user.get("session_id")
        payload["capabilities"] = sorted(get_user_capabilities(db_user))
        payload["connected_accounts"] = list_user_external_identities(user["id"])
        return payload
    return {
        "id": None,
        "email": user["email"],
        "name": None,
        "avatar": None,
        "role": validate_roles(user.get("roles") or [user.get("role")])[0],
        "roles": validate_roles(user.get("roles") or [user.get("role")]),
        "capabilities": sorted(get_user_capabilities(user)),
    }


@router.get(
    "/users/{user_id}/avatar",
    responses=AUTH_ERROR_RESPONSES,
    summary="Proxy a user's external avatar image",
)
def auth_user_avatar(request: Request, user_id: int):
    _require_auth(request)
    target = get_user_by_id(user_id)
    avatar = (target or {}).get("avatar")
    if not avatar or not _is_proxyable_avatar_url(avatar):
        raise HTTPException(status_code=404, detail="Avatar not available")

    try:
        upstream = requests.get(
            avatar,
            headers={"User-Agent": "Crate/1.0 (+https://cratemusic.app)"},
            timeout=8,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Avatar fetch failed") from exc

    if upstream.status_code != 200:
        raise HTTPException(
            status_code=upstream.status_code if upstream.status_code < 500 else 502,
            detail="Avatar fetch failed",
        )
    content_type = (
        upstream.headers.get("content-type", "image/jpeg")
        .split(";", 1)[0]
        .strip()
        .lower()
    )
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=502, detail="Avatar response was not an image")
    if len(upstream.content) > 2_000_000:
        raise HTTPException(status_code=502, detail="Avatar image is too large")

    return Response(
        content=upstream.content,
        media_type=content_type,
        headers={
            "Cache-Control": "private, max-age=86400",
            "Vary": "Authorization, Cookie",
        },
    )


@router.get("/verify")
def auth_verify(request: Request):
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
def auth_verify_soft(request: Request):
    """Soft verify: always 200 and injects identity headers if authenticated."""
    user = getattr(request.state, "user", None)
    response = Response(status_code=200)
    if user:
        response.headers["Remote-User"] = (
            user.get("username") or user.get("email") or "unknown"
        )
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
def auth_config(request: Request):
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
def auth_providers(request: Request):
    return _provider_status(request)


@router.get(
    "/sessions",
    response_model=list[AuthSessionResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List active sessions for the current user",
)
def auth_sessions(request: Request):
    user = _require_auth(request)
    return list_sessions(user["id"], include_revoked=False)


@router.post(
    "/heartbeat",
    response_model=OkResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Refresh the current session heartbeat",
)
def auth_heartbeat(request: Request, body: HeartbeatRequest):
    user = _require_auth(request)
    if user.get("session_id"):
        from crate.api.auth_cache import should_touch_session

        if should_touch_session(user["session_id"]):
            touch_session(
                user["session_id"],
                last_seen_ip=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
                app_id=body.app_id or request.headers.get("x-crate-app"),
                device_label=body.device_label or request.headers.get("x-device-label"),
                device_fingerprint=_request_device_fingerprint(
                    request, app_id=body.app_id or request.headers.get("x-crate-app")
                ),
            )
    return {"ok": True}


@router.delete(
    "/sessions/{session_id}",
    response_model=OkResponse,
    responses=_AUTH_PRIVATE_RESPONSES,
    summary="Revoke one of the current user's sessions",
)
def auth_revoke_session(request: Request, session_id: str):
    user = _require_auth(request)
    sessions = {
        session["id"] for session in list_sessions(user["id"], include_revoked=True)
    }
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    revoke_session(session_id)
    response = JSONResponse({"ok": True})
    if user.get("session_id") == session_id:
        _clear_auth_cookie(response, _cookie_name_for_request(request))
        _clear_refresh_cookie(response)
    return response


@router.post(
    "/sessions/revoke-all",
    response_model=RevokeSessionsResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Revoke all other sessions for the current user",
)
def auth_revoke_all_sessions(request: Request):
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
def update_profile(request: Request, body: UpdateProfileRequest):
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
            raise HTTPException(
                status_code=409, detail="Username is already taken"
            ) from exc
        raise
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    # Re-issue the short-lived access token with updated display fields.
    expiry_hours = _access_expiry_hours(request)
    token = create_jwt(
        updated["id"],
        updated["email"],
        updated["role"],
        username=updated.get("username"),
        name=updated.get("name"),
        session_id=user.get("session_id"),
        expires_in_hours=expiry_hours,
    )
    response = JSONResponse(content=_user_public(updated))
    _set_auth_cookie(
        response, token, _cookie_name_for_request(request), max_age=expiry_hours * 3600
    )
    return response


@router.post(
    "/change-password",
    response_model=OkResponse,
    responses=_AUTH_PRIVATE_RESPONSES,
    summary="Change the authenticated user's password",
)
def change_password(request: Request, body: ChangePasswordRequest):
    user = _require_auth(request)
    db_user = get_user_by_id(user["id"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    if db_user.get("password_hash"):
        if not verify_password(body.current_password, db_user["password_hash"]):
            raise HTTPException(status_code=401, detail="Current password is incorrect")
    if len(body.new_password) < 8:
        raise HTTPException(
            status_code=400, detail="Password must be at least 8 characters"
        )
    new_hash = hash_password(body.new_password)
    update_user(user["id"], password_hash=new_hash)
    return {"ok": True}


@router.post(
    "/subsonic-token",
    response_model=SubsonicTokenResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Generate or rotate the Subsonic token",
)
def generate_subsonic_token(request: Request):
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
def delete_subsonic_token(request: Request):
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
def get_subsonic_token(request: Request):
    """Get the current Subsonic API token (if set)."""
    user = _require_auth(request)
    db_user = get_user_by_id(user["id"])
    return {"subsonic_token": db_user.get("subsonic_token") if db_user else None}


@router.post(
    "/oauth/{provider}/start",
    response_model=OAuthStartResponse,
    responses=_AUTH_PUBLIC_RESPONSES,
    summary="Start an OAuth login flow",
)
def oauth_start(request: Request, provider: str, body: OAuthStartRequest):
    return _oauth_start_response(request, provider, body, mode="login")


def _oauth_start_response(
    request: Request,
    provider: str,
    body: OAuthStartRequest,
    *,
    mode: str,
    user_id: int | None = None,
):
    provider = provider.lower()
    if provider not in {"google", "apple"}:
        raise HTTPException(status_code=404, detail="Unknown auth provider")
    if not _provider_available(provider):
        raise HTTPException(
            status_code=403, detail=f"{provider.title()} login is unavailable"
        )

    app_id = _infer_oauth_app_id(request, body.return_to)
    native_exchange = _validate_native_oauth_start(
        app_id=app_id,
        mode=mode,
        return_to=body.return_to,
        challenge=body.native_code_challenge,
        state=body.native_state,
    )
    state = _build_oauth_state(
        provider=provider,
        return_to=body.return_to,
        mode=mode,
        user_id=user_id if mode == "link" else None,
        invite_token=body.invite_token,
        app_id=app_id,
        native_code_challenge=(body.native_code_challenge if native_exchange else None),
        native_state=body.native_state if native_exchange else None,
    )
    parsed_state = _parse_oauth_state(state)
    verifier = parsed_state["verifier"]
    common_params = {
        "redirect_uri": _oauth_callback_url(provider, body.return_to, app_id=app_id),
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
    jwk = next(
        (
            key
            for key in keys_resp.json().get("keys", [])
            if key.get("kid") == header.get("kid")
        ),
        None,
    )
    if not jwk:
        raise HTTPException(status_code=401, detail="Unable to validate Apple token")
    pyjwk = jwt.PyJWK.from_dict(jwk)
    public_key = pyjwk.key
    payload = jwt.decode(
        id_token,
        public_key,
        algorithms=["RS256"],
        audience=os.environ["APPLE_CLIENT_ID"],
        issuer="https://appleid.apple.com",
    )
    return payload


@router.get("/oauth/{provider}/callback")
def oauth_callback(request: Request, provider: str, code: str = "", state: str = ""):
    provider = provider.lower()
    if provider not in {"google", "apple"}:
        raise HTTPException(status_code=404, detail="Unknown auth provider")
    if not code or not state:
        raise HTTPException(status_code=400, detail="Invalid OAuth callback")

    # Key OAuth callback throttling by provider and client IP; using only the
    # provider would let one noisy client lock out everyone else.
    rate_key = f"oauth:{provider}:{_client_ip(request)}"
    _enforce_login_rate_limit(rate_key, request)

    try:
        parsed_state = _parse_oauth_state(state)
    except HTTPException:
        _record_failed_login(rate_key, request)
        raise
    if parsed_state.get("provider") != provider:
        _record_failed_login(rate_key, request)
        raise HTTPException(status_code=400, detail="OAuth provider mismatch")
    app_id = parsed_state.get("app_id")
    redirect_uri = _oauth_callback_url(
        provider, parsed_state.get("return_to"), app_id=app_id
    )
    verifier = parsed_state["verifier"]
    try:
        external_payload = (
            _google_userinfo(code, redirect_uri, verifier)
            if provider == "google"
            else _apple_userinfo(code, redirect_uri, verifier)
        )
    except HTTPException:
        _record_failed_login(rate_key, request)
        raise
    external_user_id, email, name, avatar = _resolve_provider_subject(
        provider, external_payload
    )
    user = get_user_by_external_identity(provider, external_user_id)
    resolved_via_legacy_google_id = False
    if not user and provider == "google":
        # Compatibility bridge for older installs that stored Google
        # identities only on users.google_id, before
        # user_external_identities became authoritative.
        user = get_user_by_google_id(external_user_id)
        resolved_via_legacy_google_id = user is not None
    # Always sync avatar from OAuth provider
    if user and avatar:
        update_user(user["id"], avatar=avatar)
        user = get_user_by_id(user["id"])
    if user and resolved_via_legacy_google_id:
        try:
            upsert_user_external_identity(
                user["id"],
                provider,
                external_user_id=external_user_id,
                external_username=email,
                status="linked",
                last_error=None,
                metadata={"email": email},
            )
        except SAIntegrityError as exc:
            _raise_oauth_identity_conflict(provider, exc)
    if parsed_state.get("mode") == "link":
        target_user_id = parsed_state.get("user_id")
        if not target_user_id:
            raise HTTPException(
                status_code=400, detail="Missing user for account linking"
            )
        user = get_user_by_id(int(target_user_id))
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        try:
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
        except SAIntegrityError as exc:
            _raise_oauth_identity_conflict(provider, exc)
        redirect_to = _validate_return_to(parsed_state.get("return_to"))
        response = RedirectResponse(url=redirect_to)
        _clear_failed_login(rate_key, request)
        return response

    if not user:
        if email:
            user = get_user_by_email(email)
        if user:
            try:
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
            except SAIntegrityError as exc:
                _raise_oauth_identity_conflict(provider, exc)
            if avatar:
                update_user(user["id"], avatar=avatar)
            user = get_user_by_id(user["id"])
        else:
            try:
                if not email:
                    raise HTTPException(
                        status_code=400,
                        detail="OAuth provider did not return an email address",
                    )
                _validate_email_domain(email)
                _consume_oauth_signup_invite(
                    _retrieve_oauth_invite_token(parsed_state.get("invite_key")),
                    email=email,
                )
            except HTTPException:
                _record_failed_login(rate_key, request)
                raise
            try:
                user = create_user(
                    email=email,
                    name=name,
                    avatar=avatar,
                    google_id=external_user_id if provider == "google" else None,
                )
                upsert_user_external_identity(
                    user["id"],
                    provider,
                    external_user_id=external_user_id,
                    external_username=email,
                    status="linked",
                    last_error=None,
                    metadata={"email": email},
                )
            except SAIntegrityError as exc:
                _raise_oauth_identity_conflict(provider, exc)

    if not user:
        raise HTTPException(status_code=401, detail="OAuth user could not be loaded")
    _ensure_user_active(user)

    native_challenge = parsed_state.get("native_code_challenge")
    native_state = parsed_state.get("native_state")
    if native_challenge is not None or native_state is not None:
        _validate_native_oauth_start(
            app_id=app_id,
            mode=str(parsed_state.get("mode") or ""),
            return_to=parsed_state.get("return_to"),
            challenge=native_challenge,
            state=native_state,
        )
        try:
            handoff_code = issue_native_oauth_handoff(
                user_id=int(user["id"]),
                app_id=str(app_id),
                state=str(native_state),
                challenge=str(native_challenge),
            )
        except NativeOAuthUnavailable as exc:
            raise HTTPException(
                status_code=503,
                detail="Native OAuth exchange is temporarily unavailable",
            ) from exc
        _clear_failed_login(rate_key, request)
        redirect_url = _append_query_param(
            _NATIVE_CALLBACK_URL,
            "code",
            handoff_code,
        )
        redirect_url = _append_query_param(
            redirect_url,
            "state",
            str(native_state),
        )
        return RedirectResponse(url=redirect_url)

    update_user_last_login(user["id"])
    token, _session, refresh_token = _create_login_session(user, request, app_id=app_id)
    _clear_failed_login(rate_key, request)

    return_to = parsed_state.get("return_to") or "/"
    safe_return = _validate_return_to(return_to, app_id=app_id)

    if safe_return.startswith("cratemusic://"):
        redirect_url = _append_query_param(safe_return, "token", token)
        access_expires_at = _access_expires_at_from_token(token)
        if access_expires_at:
            redirect_url = _append_query_param(
                redirect_url, "access_expires_at", _iso_datetime(access_expires_at)
            )
        if refresh_token:
            redirect_url = _append_query_param(
                redirect_url, "refresh_token", refresh_token
            )
        return RedirectResponse(url=redirect_url)

    if safe_return.startswith("http"):
        redirect_url = _post_auth_redirect_url(safe_return, token)
        access_expires_at = _access_expires_at_from_token(token)
        if access_expires_at:
            redirect_url = _append_query_param(
                redirect_url, "access_expires_at", _iso_datetime(access_expires_at)
            )
        if refresh_token and _is_native_listen_app_id(app_id):
            redirect_url = _append_query_param(
                redirect_url, "refresh_token", refresh_token
            )
        response = RedirectResponse(url=redirect_url)
        _set_login_cookies(
            response,
            request,
            token,
            refresh_token,
            app_id=app_id,
            return_to=safe_return,
        )
        return response

    redirect_url = _post_auth_redirect_url(safe_return, token)
    access_expires_at = _access_expires_at_from_token(token)
    if access_expires_at:
        redirect_url = _append_query_param(
            redirect_url, "access_expires_at", _iso_datetime(access_expires_at)
        )
    response = RedirectResponse(url=redirect_url)
    _set_login_cookies(
        response, request, token, refresh_token, app_id=app_id, return_to=safe_return
    )
    return response


@router.post(
    "/native/exchange",
    response_model=AuthLoginResponse,
    responses=_AUTH_PUBLIC_RESPONSES,
    summary="Exchange a native OAuth handoff code",
)
def native_oauth_exchange(request: Request, body: NativeOAuthExchangeRequest):
    if not _native_oauth_exchange_enabled():
        raise HTTPException(
            status_code=503,
            detail="Native OAuth exchange is not enabled",
        )
    app_id = (request.headers.get("x-crate-app") or "").strip().lower()
    if not _is_mobile_native_listen_app_id(app_id):
        raise HTTPException(status_code=400, detail="Invalid native OAuth client")
    if not _NATIVE_VERIFIER_RE.fullmatch(body.code_verifier):
        raise HTTPException(
            status_code=400,
            detail="Invalid native OAuth code verifier",
        )
    if not _NATIVE_STATE_RE.fullmatch(body.state):
        raise HTTPException(status_code=400, detail="Invalid native OAuth state")
    try:
        handoff = consume_native_oauth_handoff(
            code=body.code,
            state=body.state,
            verifier=body.code_verifier,
        )
    except InvalidNativeOAuthHandoff as exc:
        raise HTTPException(
            status_code=401,
            detail="Native OAuth handoff is invalid or expired",
        ) from exc
    except NativeOAuthUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail="Native OAuth exchange is temporarily unavailable",
        ) from exc
    if not secrets.compare_digest(handoff.app_id, app_id):
        raise HTTPException(status_code=401, detail="Native OAuth client mismatch")
    user = get_user_by_id(handoff.user_id)
    user = _ensure_user_active(user)
    update_user_last_login(user["id"])
    token, session, refresh_token = _create_login_session(
        user,
        request,
        app_id=app_id,
    )
    return _auth_login_payload(user, token, session, refresh_token)


@router.post(
    "/oauth/{provider}/unlink",
    response_model=OkResponse,
    responses=_AUTH_PRIVATE_RESPONSES,
    summary="Unlink an OAuth provider from the current account",
)
def oauth_unlink(request: Request, provider: str):
    user = _require_auth(request)
    db_user = get_user_by_id(user["id"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    identity = get_user_external_identity(user["id"], provider)
    if not identity or identity.get("status") == "unlinked":
        raise HTTPException(
            status_code=400, detail=f"No {provider.title()} account linked"
        )
    if (
        not db_user.get("password_hash")
        and len(list_user_external_identities(user["id"])) <= 1
    ):
        raise HTTPException(
            status_code=400,
            detail="Set a password or link another provider before unlinking this account",
        )
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
def oauth_link(request: Request, provider: str, body: OAuthStartRequest):
    user = _require_auth(request)
    return _oauth_start_response(
        request, provider, body, mode="link", user_id=user["id"]
    )


@router.post("/unlink-google")
def unlink_google(request: Request):
    return oauth_unlink(request, "google")


@router.get("/google")
def google_login(request: Request, return_to: str | None = None):
    payload = oauth_start(request, "google", OAuthStartRequest(return_to=return_to))
    return RedirectResponse(url=payload["login_url"])


@router.get("/google/callback")
def google_callback(request: Request, code: str = "", state: str = ""):
    return oauth_callback(request, "google", code=code, state=state)


@router.get("/apple")
def apple_login(request: Request, return_to: str | None = None):
    payload = oauth_start(request, "apple", OAuthStartRequest(return_to=return_to))
    return RedirectResponse(url=payload["login_url"])


@router.get("/apple/callback")
def apple_callback(request: Request, code: str = "", state: str = ""):
    return oauth_callback(request, "apple", code=code, state=state)


# ── Admin: user management ──────────────────────────────────────


@router.get(
    "/users",
    response_model=list[AdminUserSummaryResponse],
    responses=_AUTH_ADMIN_RESPONSES,
    summary="List users for administration",
)
def admin_list_users(request: Request):
    _require_users_view(request)
    return [_with_capabilities(user) for user in list_users()]


@router.get(
    "/roles",
    responses=_AUTH_ADMIN_RESPONSES,
    summary="List role presets and capabilities",
)
def admin_list_roles(request: Request):
    _require_roles_view(request)
    return {
        "capabilities": list(ALL_CAPABILITIES),
        "roles": [
            {
                "slug": role,
                "name": role.replace("_", " ").title(),
                "capabilities": sorted(get_user_capabilities({"role": role})),
                "system": True,
            }
            for role in ROLE_CAPABILITIES
        ],
    }


@admin_router.get(
    "/providers",
    response_model=AuthProvidersResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="List provider configuration for administrators",
)
def admin_get_auth_providers(request: Request):
    _require_auth_manage(request)
    return _provider_status(request)


@admin_router.get(
    "/config",
    response_model=AdminAuthConfigResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="Get admin-only authentication settings",
)
def admin_get_auth_config(request: Request):
    _require_auth_manage(request)
    return {
        "invite_only": get_setting("auth_invite_only", "false") == "true",
    }


@admin_router.put(
    "/config",
    response_model=AdminAuthConfigResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="Update admin-only authentication settings",
)
def admin_update_auth_config(request: Request, body: AuthConfigUpdateRequest):
    _require_auth_manage(request)
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
def admin_toggle_auth_provider(
    request: Request, provider: str, body: ProviderToggleRequest
):
    _require_auth_manage(request)
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
def admin_create_auth_invite(request: Request, body: AuthInviteRequest):
    user = _require_users_create(request)
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
def admin_list_auth_invites(request: Request):
    _require_users_view(request)
    return list_auth_invites()


@router.post(
    "/users",
    response_model=AuthUserPublicResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="Create a user as an administrator",
)
def admin_create_user(request: Request, body: CreateUserRequest):
    admin_user = _require_users_create(request)
    roles = validate_roles(body.roles or [body.role])
    if roles != ["user"]:
        _require_roles_assign(request)
    if len(body.password) < 8:
        raise HTTPException(
            status_code=400, detail="Password must be at least 8 characters"
        )
    existing = get_user_by_email(body.email)
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    pw_hash = hash_password(body.password)
    user = create_user(
        email=body.email, name=body.name, password_hash=pw_hash, role=roles[0]
    )
    set_user_roles(user["id"], roles, assigned_by=admin_user.get("id"))
    user = get_user_by_id(user["id"]) or user
    log_audit(
        "create_user",
        "user",
        body.email,
        details={"role": roles[0], "roles": roles, "source": "admin"},
        user_id=admin_user.get("id"),
    )
    return _user_public(user)


@router.get(
    "/users/{user_id}",
    response_model=AdminUserDetailResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="Get a user with sessions and linked accounts",
)
def admin_get_user_detail(request: Request, user_id: int):
    _require_users_view(request)
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    payload = _user_public(user)
    payload["status"] = _user_status(user)
    payload["status_reason"] = user.get("status_reason")
    payload["suspended_at"] = _iso_datetime(user.get("suspended_at"))
    payload["deleted_at"] = _iso_datetime(user.get("deleted_at"))
    payload["capabilities"] = sorted(get_user_capabilities(user))
    payload["username"] = user.get("username")
    payload["bio"] = user.get("bio")
    payload["has_password"] = bool(user.get("password_hash"))
    payload["created_at"] = _iso_datetime(user.get("created_at"))
    payload["last_login"] = _iso_datetime(user.get("last_login"))
    payload["connected_accounts"] = list_user_external_identities(user_id)
    payload["sessions"] = list_sessions(user_id, include_revoked=True)
    presence = get_user_presence(user_id)
    payload.update(presence)
    payload.update(
        derive_user_activity(
            last_login=payload.get("last_login"),
            last_seen_at=presence.get("last_seen_at"),
            last_played_at=presence.get("last_played_at"),
        )
    )
    return payload


@router.patch(
    "/users/{user_id}/role",
    response_model=AdminUserDetailResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="Update a user's role",
)
def admin_update_user_role(request: Request, user_id: int, body: UpdateUserRoleRequest):
    admin_user = _require_roles_assign(request)
    next_roles = validate_roles(body.roles or [body.role])
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    previous_roles = validate_roles(user.get("roles") or [user.get("role")])
    if previous_roles == next_roles:
        return admin_get_user_detail(request, user_id)

    _ensure_role_change_is_safe(admin_user, user, next_roles)
    set_user_roles(user_id, next_roles, assigned_by=admin_user.get("id"))
    updated = get_user_by_id(user_id)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    _invalidate_auth_user(user_id)
    log_audit(
        "update_user_role",
        "user",
        updated["email"],
        details={
            "before": {"roles": previous_roles},
            "after": {"roles": next_roles},
            "changed_fields": ["role", "roles"],
            "source": "admin",
        },
        user_id=admin_user.get("id"),
    )
    return admin_get_user_detail(request, user_id)


@router.patch(
    "/users/{user_id}/status",
    response_model=AdminUserDetailResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="Update a user's lifecycle status",
)
def admin_update_user_status(
    request: Request, user_id: int, body: UpdateUserStatusRequest
):
    admin_user = _require_users_status_manage(request)
    next_status = body.status.strip().lower()
    if next_status not in {"active", "suspended", "deleted"}:
        raise HTTPException(status_code=422, detail="Unsupported user status")
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    previous_status = _user_status(user)
    if previous_status == next_status:
        return admin_get_user_detail(request, user_id)

    _ensure_status_change_is_safe(admin_user, user, next_status)
    updated = update_user_status(
        user_id,
        next_status,
        reason=body.reason,
        actor_user_id=admin_user.get("id"),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    revoked = 0
    if body.revoke_sessions and next_status != "active":
        revoked = _revoke_user_sessions(user_id, None)
    _invalidate_auth_user(user_id)
    log_audit(
        "update_user_status",
        "user",
        updated["email"],
        details={
            "before": {"status": previous_status},
            "after": {"status": next_status},
            "changed_fields": ["status"],
            "reason": body.reason,
            "revoked_sessions": revoked,
            "source": "admin",
        },
        user_id=admin_user.get("id"),
    )
    return admin_get_user_detail(request, user_id)


@router.post(
    "/users/{user_id}/set-password",
    response_model=RevokeSessionsResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="Set or reset a user's local password",
)
def admin_set_user_password(
    request: Request, user_id: int, body: AdminSetPasswordRequest
):
    admin_user = _require_users_password_manage(request)
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if len(body.new_password) < 8:
        raise HTTPException(
            status_code=400, detail="Password must be at least 8 characters"
        )

    update_user(user_id, password_hash=hash_password(body.new_password))
    _invalidate_auth_user(user_id)

    revoked = 0
    if body.revoke_all_sessions:
        current_session_id = (
            admin_user.get("session_id") if admin_user.get("id") == user_id else None
        )
        revoked = _revoke_user_sessions(user_id, current_session_id)
    log_audit(
        "set_user_password",
        "user",
        user["email"],
        details={
            "changed_fields": ["password_hash"],
            "revoked_sessions": revoked,
            "source": "admin",
        },
        user_id=admin_user.get("id"),
    )
    return {"ok": True, "revoked": revoked}


@router.get(
    "/users/{user_id}/sessions",
    response_model=list[AuthSessionResponse],
    responses=_AUTH_ADMIN_RESPONSES,
    summary="List sessions for a user",
)
def admin_get_user_sessions(request: Request, user_id: int):
    _require_users_view(request)
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
def admin_revoke_user_session(request: Request, user_id: int, session_id: str):
    admin_user = _require_users_sessions_manage(request)
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    sessions = {
        session["id"] for session in list_sessions(user_id, include_revoked=True)
    }
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    revoke_session(session_id)
    _invalidate_auth_session(session_id)
    log_audit(
        "revoke_user_session",
        "user",
        user["email"],
        details={"session_id": session_id, "source": "admin"},
        user_id=admin_user.get("id"),
    )
    return {"ok": True}


@router.post(
    "/users/{user_id}/sessions/revoke-all",
    response_model=RevokeSessionsResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="Revoke all sessions for a user",
)
def admin_revoke_all_user_sessions(request: Request, user_id: int):
    admin_user = _require_users_sessions_manage(request)
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    revoked = _revoke_user_sessions(user_id, None)
    log_audit(
        "revoke_all_user_sessions",
        "user",
        user["email"],
        details={"revoked_sessions": revoked, "source": "admin"},
        user_id=admin_user.get("id"),
    )
    return {"ok": True, "revoked": revoked}


@router.delete(
    "/users/{user_id}",
    response_model=OkResponse,
    responses=_AUTH_ADMIN_RESPONSES,
    summary="Delete a user",
)
def admin_delete_user(request: Request, user_id: int):
    admin_user = _require_users_delete(request)
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _ensure_status_change_is_safe(admin_user, user, "deleted")
    contributions = list_user_album_contributions(user_id)
    if contributions:
        create_task(
            "library_cleanup_user_contributions",
            {"user_id": user_id, "contributions": contributions},
        )
    updated = update_user_status(
        user_id,
        "deleted",
        reason="Deleted by administrator",
        actor_user_id=admin_user.get("id"),
    )
    _revoke_user_sessions(user_id, None)
    _invalidate_auth_user(user_id)
    log_audit(
        "delete_user",
        "user",
        user["email"],
        details={
            "before": {"status": _user_status(user)},
            "after": {"status": "deleted"},
            "changed_fields": ["status"],
            "source": "admin",
            "soft_delete": True,
            "contributions": len(contributions),
        },
        user_id=admin_user.get("id"),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}
