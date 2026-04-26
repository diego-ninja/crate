from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from crate.db.tx import transaction_scope


def create_jam_room_invite(
    room_id: str,
    created_by: int | None,
    *,
    expires_in_hours: int = 24,
    max_uses: int | None = 20,
) -> dict:
    token = secrets.token_urlsafe(24)
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(hours=expires_in_hours)).isoformat() if expires_in_hours > 0 else None
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                INSERT INTO jam_room_invites (token, room_id, created_by, expires_at, max_uses, created_at)
                VALUES (:token, :room_id, :created_by, :expires_at, :max_uses, :created_at)
                RETURNING *
                """
            ),
            {
                "token": token,
                "room_id": room_id,
                "created_by": created_by,
                "expires_at": expires_at,
                "max_uses": max_uses,
                "created_at": now.isoformat(),
            },
        ).mappings().first()
    return dict(row)


def consume_jam_room_invite(token: str) -> dict | None:
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                UPDATE jam_room_invites
                SET use_count = use_count + 1
                WHERE token = :token
                  AND (expires_at IS NULL OR expires_at > :now)
                  AND (max_uses IS NULL OR use_count < max_uses)
                RETURNING *
                """
            ),
            {"token": token, "now": now},
        ).mappings().first()
    return dict(row) if row else None


__all__ = [
    "consume_jam_room_invite",
    "create_jam_room_invite",
]
