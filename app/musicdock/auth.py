import os
import secrets
from datetime import datetime, timezone, timedelta

import jwt
from passlib.hash import bcrypt as _bcrypt_handler

# Fix passlib + bcrypt >= 4.1 compatibility
bcrypt = _bcrypt_handler.using(truncate_error=True)

from musicdock.db import get_setting, set_setting

JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24


def _get_jwt_secret() -> str:
    secret = os.environ.get("JWT_SECRET")
    if secret:
        return secret
    stored = get_setting("jwt_secret")
    if stored:
        return stored
    generated = secrets.token_hex(32)
    set_setting("jwt_secret", generated)
    return generated


def hash_password(password: str) -> str:
    return bcrypt.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.verify(password, password_hash)


def create_jwt(user_id: int, email: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "user_id": user_id,
        "email": email,
        "role": role,
        "iat": now,
        "exp": now + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, _get_jwt_secret(), algorithm=JWT_ALGORITHM)


def verify_jwt(token: str) -> dict | None:
    try:
        return jwt.decode(token, _get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except (jwt.InvalidTokenError, jwt.ExpiredSignatureError):
        return None
