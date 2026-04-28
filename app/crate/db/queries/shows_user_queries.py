from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_attending_show_ids(user_id: int, show_ids: list[int]) -> set[int]:
    if not show_ids:
        return set()
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT show_id
                FROM user_show_attendance
                WHERE user_id = :user_id AND show_id = ANY(:show_ids)
                """
            ),
            {"user_id": user_id, "show_ids": show_ids},
        ).mappings().all()
    return {row["show_id"] for row in rows}


def get_show_reminders(user_id: int, show_ids: list[int] | None = None) -> list[dict]:
    with read_scope() as session:
        if show_ids:
            rows = session.execute(
                text(
                    """
                    SELECT id, user_id, show_id, reminder_type, created_at, triggered_at
                    FROM user_show_reminders
                    WHERE user_id = :user_id AND show_id = ANY(:show_ids)
                    """
                ),
                {"user_id": user_id, "show_ids": show_ids},
            ).mappings().all()
        else:
            rows = session.execute(
                text(
                    """
                    SELECT id, user_id, show_id, reminder_type, created_at, triggered_at
                    FROM user_show_reminders
                    WHERE user_id = :user_id
                    """
                ),
                {"user_id": user_id},
            ).mappings().all()
    return [dict(row) for row in rows]


__all__ = [
    "get_attending_show_ids",
    "get_show_reminders",
]
