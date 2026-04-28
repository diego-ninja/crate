from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from crate.db.orm.user import AuthInvite
from crate.db.repositories.auth_shared import model_to_dict
from crate.db.tx import optional_scope, read_scope


def create_auth_invite(
    created_by: int | None,
    *,
    email: str | None = None,
    expires_in_hours: int = 168,
    max_uses: int | None = 1,
    session=None,
) -> dict:
    def _impl(s) -> dict:
        now = datetime.now(timezone.utc)
        invite = AuthInvite(
            token=secrets.token_urlsafe(24),
            email=email,
            created_by=created_by,
            expires_at=(now + timedelta(hours=expires_in_hours)) if expires_in_hours > 0 else None,
            max_uses=max_uses,
            created_at=now,
        )
        s.add(invite)
        s.flush()
        return model_to_dict(invite)

    with optional_scope(session) as s:
        return _impl(s)


def get_auth_invite(token: str) -> dict | None:
    with read_scope() as session:
        invite = session.get(AuthInvite, token)
        return model_to_dict(invite) if invite is not None else None


def list_auth_invites(created_by: int | None = None) -> list[dict]:
    with read_scope() as session:
        stmt = select(AuthInvite)
        if created_by is not None:
            stmt = stmt.where(AuthInvite.created_by == created_by)
        rows = session.execute(stmt.order_by(AuthInvite.created_at.desc())).scalars().all()
        return [model_to_dict(row) for row in rows]


def consume_auth_invite(token: str, *, session=None) -> dict | None:
    def _impl(s) -> dict | None:
        invite = s.get(AuthInvite, token)
        if invite is None:
            return None
        now = datetime.now(timezone.utc)
        if invite.expires_at is not None and invite.expires_at <= now:
            return None
        if invite.max_uses is not None and int(invite.use_count or 0) >= invite.max_uses:
            return None
        invite.use_count = int(invite.use_count or 0) + 1
        if invite.accepted_at is None:
            invite.accepted_at = now
        s.flush()
        return model_to_dict(invite)

    with optional_scope(session) as s:
        return _impl(s)


__all__ = [
    "consume_auth_invite",
    "create_auth_invite",
    "get_auth_invite",
    "list_auth_invites",
]
