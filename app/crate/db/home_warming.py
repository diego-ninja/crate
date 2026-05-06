from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def list_recent_home_user_ids(*, window_minutes: int = 30, limit: int = 10) -> list[int]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT user_id
                FROM sessions
                WHERE revoked_at IS NULL
                  AND expires_at > NOW()
                  AND COALESCE(last_seen_at, created_at) >= NOW() - (:window_minutes * INTERVAL '1 minute')
                GROUP BY user_id
                ORDER BY MAX(COALESCE(last_seen_at, created_at)) DESC
                LIMIT :limit
                """
            ),
            {
                "window_minutes": max(1, int(window_minutes)),
                "limit": max(1, min(int(limit), 50)),
            },
        ).mappings().all()
    return [int(row["user_id"]) for row in rows if row.get("user_id") is not None]


__all__ = ["list_recent_home_user_ids"]
