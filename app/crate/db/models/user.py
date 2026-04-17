"""Typed models for auth-related data.

Covers the ``users``, ``sessions``, and ``auth_invites`` tables.
"""


from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserRow(BaseModel):
    """Full user record from the ``users`` table."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    username: str | None = None
    name: str | None = None
    bio: str | None = None
    password_hash: str | None = None
    avatar: str | None = None
    role: str = "user"
    google_id: str | None = None
    subsonic_token: str | None = None
    created_at: datetime | None = None
    last_login: datetime | None = None


class SessionRow(BaseModel):
    """Full session record from the ``sessions`` table."""
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: int
    expires_at: datetime
    created_at: datetime | None = None
    revoked_at: datetime | None = None
    last_seen_at: datetime | None = None
    last_seen_ip: str | None = None
    user_agent: str | None = None
    app_id: str | None = None
    device_label: str | None = None


class AuthInviteRow(BaseModel):
    """Auth invite record from the ``auth_invites`` table."""
    model_config = ConfigDict(from_attributes=True)

    token: str
    email: str | None = None
    created_by: int | None = None
    expires_at: datetime | None = None
    max_uses: int | None = None
    use_count: int = 0
    accepted_at: datetime | None = None
    created_at: datetime | None = None
