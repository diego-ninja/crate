"""User lookup queries for the Subsonic API."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_user_by_username(username: str) -> dict | None:
    with read_scope() as session:
        row = session.execute(
            text("SELECT * FROM users WHERE username = :username"),
            {"username": username},
        ).mappings().first()
    return dict(row) if row else None


__all__ = [
    "get_user_by_username",
]
