from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import transaction_scope


_MEMBER_SELECT_SQL = text(
    """
    SELECT
        jrm.room_id,
        jrm.user_id,
        jrm.role,
        jrm.joined_at,
        jrm.last_seen_at,
        u.username,
        COALESCE(NULLIF(u.name, ''), NULLIF(u.username, ''), NULLIF(split_part(u.email, '@', 1), '')) AS display_name,
        u.avatar
    FROM jam_room_members jrm
    JOIN users u ON u.id = jrm.user_id
    WHERE jrm.room_id = :room_id
    """
)


def get_jam_room_members(room_id: str) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text(f"{_MEMBER_SELECT_SQL.text} ORDER BY jrm.joined_at ASC"),
            {"room_id": room_id},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_jam_room_member(room_id: str, user_id: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text(f"{_MEMBER_SELECT_SQL.text} AND jrm.user_id = :user_id LIMIT 1"),
            {"room_id": room_id, "user_id": user_id},
        ).mappings().first()
    return dict(row) if row else None


def is_jam_room_member(room_id: str, user_id: int) -> bool:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT 1 FROM jam_room_members WHERE room_id = :room_id AND user_id = :user_id"),
            {"room_id": room_id, "user_id": user_id},
        ).mappings().first()
    return row is not None


def upsert_jam_room_member(room_id: str, user_id: int, role: str = "collab") -> bool:
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO jam_room_members (room_id, user_id, role, joined_at, last_seen_at)
                VALUES (:room_id, :user_id, :role, :joined_at, :last_seen_at)
                ON CONFLICT (room_id, user_id) DO UPDATE SET
                    role = EXCLUDED.role,
                    last_seen_at = EXCLUDED.last_seen_at
                """
            ),
            {
                "room_id": room_id,
                "user_id": user_id,
                "role": role,
                "joined_at": now,
                "last_seen_at": now,
            },
        )
    return True


def touch_jam_room_member(room_id: str, user_id: int) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        result = session.execute(
            text("UPDATE jam_room_members SET last_seen_at = :now WHERE room_id = :room_id AND user_id = :user_id"),
            {"now": now, "room_id": room_id, "user_id": user_id},
        )
    return result.rowcount > 0


__all__ = [
    "get_jam_room_member",
    "get_jam_room_members",
    "is_jam_room_member",
    "touch_jam_room_member",
    "upsert_jam_room_member",
]
