from __future__ import annotations

import logging
import os
import re
import secrets
from datetime import datetime, timezone

from sqlalchemy import func, select

from crate.db.orm.user import User, UserExternalIdentity
from crate.db.repositories.auth_shared import model_to_dict
from crate.db.tx import optional_scope, read_scope, transaction_scope

log = logging.getLogger(__name__)


def suggest_username(email: str, preferred: str | None = None, *, session=None) -> str:
    base = (preferred or email.split("@")[0]).strip().lower()
    base = re.sub(r"[^a-z0-9._-]+", "-", base).strip(".-_") or "user"

    def _impl(s) -> str:
        candidate = base
        suffix = 1
        while True:
            exists = s.execute(select(User.id).where(User.username == candidate).limit(1)).scalar_one_or_none()
            if exists is None:
                return candidate
            candidate = f"{base}-{suffix}"
            suffix += 1

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def count_users() -> int:
    with read_scope() as session:
        return int(session.execute(select(func.count()).select_from(User)).scalar_one() or 0)


def _seed_admin(session=None):
    if session is None:
        with transaction_scope() as s:
            return _seed_admin(s)

    total_users = int(session.execute(select(func.count()).select_from(User)).scalar_one() or 0)
    if total_users == 0:
        from crate.auth import hash_password

        password = os.environ.get("DEFAULT_ADMIN_PASSWORD", "")
        if not password:
            password = secrets.token_urlsafe(16)
            log.warning("No DEFAULT_ADMIN_PASSWORD set — generated: %s", password)

        existing = session.execute(select(User).where(User.email == "admin@cratemusic.app").limit(1)).scalar_one_or_none()
        if existing is None:
            session.add(
                User(
                    email="admin@cratemusic.app",
                    username="admin",
                    name="Admin",
                    password_hash=hash_password(password),
                    role="admin",
                    created_at=datetime.now(timezone.utc),
                )
            )
    else:
        admin = session.execute(select(User).where(User.email == "admin@cratemusic.app").limit(1)).scalar_one_or_none()
        if admin is not None and not admin.username:
            admin.username = "admin"


def create_user(
    email: str,
    name: str | None = None,
    password_hash: str | None = None,
    avatar: str | None = None,
    role: str = "user",
    google_id: str | None = None,
    username: str | None = None,
    *,
    session=None,
) -> dict:
    def _impl(s) -> dict:
        existing = s.execute(select(User).where(User.email == email).limit(1)).scalar_one_or_none()
        if existing is not None:
            raise ValueError(f"Email already registered: {email}")

        final_username = username or suggest_username(email, session=s)
        user = User(
            email=email,
            username=final_username,
            name=name,
            password_hash=password_hash,
            avatar=avatar,
            role=role,
            google_id=google_id,
            created_at=datetime.now(timezone.utc),
        )
        s.add(user)
        s.flush()
        return model_to_dict(user)

    with optional_scope(session) as s:
        return _impl(s)


def get_user_by_email(email: str) -> dict | None:
    with read_scope() as session:
        user = session.execute(select(User).where(User.email == email).limit(1)).scalar_one_or_none()
        return model_to_dict(user) if user is not None else None


def get_user_by_google_id(google_id: str) -> dict | None:
    with read_scope() as session:
        user = session.execute(select(User).where(User.google_id == google_id).limit(1)).scalar_one_or_none()
        return model_to_dict(user) if user is not None else None


def get_user_by_external_identity(provider: str, external_user_id: str) -> dict | None:
    with read_scope() as session:
        user = session.execute(
            select(User)
            .join(UserExternalIdentity, UserExternalIdentity.user_id == User.id)
            .where(
                UserExternalIdentity.provider == provider,
                UserExternalIdentity.external_user_id == external_user_id,
            )
            .limit(1)
        ).scalar_one_or_none()
        return model_to_dict(user) if user is not None else None


def get_user_by_id(user_id: int, *, session=None) -> dict | None:
    def _impl(s) -> dict | None:
        user = s.get(User, user_id)
        return model_to_dict(user) if user is not None else None

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


__all__ = [
    "_seed_admin",
    "count_users",
    "create_user",
    "get_user_by_email",
    "get_user_by_external_identity",
    "get_user_by_google_id",
    "get_user_by_id",
    "suggest_username",
]
