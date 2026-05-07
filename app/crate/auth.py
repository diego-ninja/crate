import logging
import os
import secrets
from datetime import datetime, timezone, timedelta

import jwt
import bcrypt as _bcrypt

from crate.db.cache_settings import get_setting, set_setting

JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24
LISTEN_ACCESS_TOKEN_EXPIRY_HOURS = 1
LISTEN_REFRESH_TOKEN_EXPIRY_DAYS = 30

log = logging.getLogger(__name__)


def _get_jwt_secret() -> str:
    secret = os.environ.get("JWT_SECRET")
    if secret:
        return secret
    stored = get_setting("jwt_secret")
    if stored:
        return stored
    generated = secrets.token_hex(32)
    log.warning(
        "JWT_SECRET is not configured; generated and stored an instance secret. "
        "Set JWT_SECRET explicitly in production so sessions survive rebuilds and restores."
    )
    set_setting("jwt_secret", generated)
    return generated


def hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode(), _bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return _bcrypt.checkpw(password.encode(), password_hash.encode())


def create_jwt(
    user_id: int,
    email: str,
    role: str,
    username: str | None = None,
    name: str | None = None,
    session_id: str | None = None,
    expires_in_hours: int | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    expiry_hours = expires_in_hours or JWT_EXPIRY_HOURS
    payload = {
        "user_id": user_id,
        "email": email,
        "role": role,
        "username": username,
        "name": name,
        "sid": session_id,
        "iat": now,
        "exp": now + timedelta(hours=expiry_hours),
    }
    return jwt.encode(payload, _get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_jwt(user_id: int, session_id: str, expires_at: datetime) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "typ": "refresh",
        "user_id": user_id,
        "sid": session_id,
        "iat": now,
        "exp": expires_at,
    }
    return jwt.encode(payload, _get_jwt_secret(), algorithm=JWT_ALGORITHM)


def verify_jwt(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, _get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("typ") == "refresh":
            return None
        return payload
    except (jwt.InvalidTokenError, jwt.ExpiredSignatureError):
        return None


def verify_refresh_jwt(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, _get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except (jwt.InvalidTokenError, jwt.ExpiredSignatureError):
        return None
    if payload.get("typ") != "refresh":
        return None
    if not payload.get("sid") or not payload.get("user_id"):
        return None
    return payload
