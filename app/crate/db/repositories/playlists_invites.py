"""Invite helpers for playlist repository modules."""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import optional_scope


def create_playlist_invite(
    playlist_id: int,
    created_by: int | None,
    *,
    expires_in_hours: int = 168,
    max_uses: int | None = 20,
    session: Session | None = None,
) -> dict:
    def _impl(s: Session) -> dict:
        now = datetime.now(timezone.utc)
        token = secrets.token_urlsafe(24)
        if expires_in_hours > 0:
            expires_at_iso = datetime.fromtimestamp(now.timestamp() + expires_in_hours * 3600, timezone.utc).isoformat()
        else:
            expires_at_iso = None
        row = s.execute(
            text(
                """
                INSERT INTO playlist_invites (token, playlist_id, created_by, expires_at, max_uses, created_at)
                VALUES (:token, :playlist_id, :created_by, :expires_at, :max_uses, :created_at)
                RETURNING *
                """
            ),
            {
                "token": token,
                "playlist_id": playlist_id,
                "created_by": created_by,
                "expires_at": expires_at_iso,
                "max_uses": max_uses,
                "created_at": now.isoformat(),
            },
        ).mappings().first()
        return dict(row) if row else {}

    with optional_scope(session) as s:
        return _impl(s)


def consume_playlist_invite(token: str, *, session: Session | None = None) -> dict | None:
    def _impl(s: Session) -> dict | None:
        now = datetime.now(timezone.utc).isoformat()
        row = s.execute(
            text(
                """
                UPDATE playlist_invites
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

    with optional_scope(session) as s:
        return _impl(s)


__all__ = ["consume_playlist_invite", "create_playlist_invite"]
