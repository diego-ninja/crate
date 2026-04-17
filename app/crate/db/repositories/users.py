"""Users repository — ORM-backed CRUD for users and sessions.

Follows the same pattern as settings.py: Session-based, typed returns,
optional standalone mode.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import transaction_scope


def get_user_by_id(user_id: int, *, session: Session | None = None) -> dict | None:
    """Fetch a user by primary key. Returns full row as dict."""
    def _impl(s: Session) -> dict | None:
        row = s.execute(
            text("SELECT * FROM users WHERE id = :id"),
            {"id": user_id},
        ).mappings().first()
        return dict(row) if row else None

    if session is not None:
        return _impl(session)
    with transaction_scope() as s:
        return _impl(s)


def get_user_by_email(email: str, *, session: Session | None = None) -> dict | None:
    """Fetch a user by email."""
    def _impl(s: Session) -> dict | None:
        row = s.execute(
            text("SELECT * FROM users WHERE email = :email"),
            {"email": email},
        ).mappings().first()
        return dict(row) if row else None

    if session is not None:
        return _impl(session)
    with transaction_scope() as s:
        return _impl(s)


def get_user_by_username(username: str, *, session: Session | None = None) -> dict | None:
    """Fetch a user by username."""
    def _impl(s: Session) -> dict | None:
        row = s.execute(
            text("SELECT * FROM users WHERE username = :username"),
            {"username": username},
        ).mappings().first()
        return dict(row) if row else None

    if session is not None:
        return _impl(session)
    with transaction_scope() as s:
        return _impl(s)


def create_session_row(
    session_id: str,
    user_id: int,
    expires_at: datetime,
    *,
    ip: str | None = None,
    user_agent: str | None = None,
    app_id: str | None = None,
    device_label: str | None = None,
    session: Session | None = None,
) -> dict:
    """Insert a new session row."""
    now = datetime.now(timezone.utc)

    def _impl(s: Session) -> dict:
        s.execute(
            text("""
                INSERT INTO sessions (id, user_id, expires_at, created_at,
                    last_seen_at, last_seen_ip, user_agent, app_id, device_label)
                VALUES (:id, :user_id, :expires_at, :now,
                    :now, :ip, :ua, :app_id, :device_label)
            """),
            {
                "id": session_id,
                "user_id": user_id,
                "expires_at": expires_at,
                "now": now,
                "ip": ip,
                "ua": user_agent,
                "app_id": app_id,
                "device_label": device_label,
            },
        )
        return {
            "id": session_id,
            "user_id": user_id,
            "expires_at": expires_at,
            "created_at": now,
        }

    if session is not None:
        return _impl(session)
    with transaction_scope() as s:
        return _impl(s)


def count_users(*, session: Session | None = None) -> int:
    """Return total number of users."""
    def _impl(s: Session) -> int:
        row = s.execute(text("SELECT COUNT(*)::INTEGER AS cnt FROM users")).mappings().first()
        return row["cnt"] if row else 0

    if session is not None:
        return _impl(session)
    with transaction_scope() as s:
        return _impl(s)
