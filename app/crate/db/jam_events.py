from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import transaction_scope


def append_jam_room_event(
    room_id: str,
    event_type: str,
    payload: dict | None = None,
    user_id: int | None = None,
) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                INSERT INTO jam_room_events (room_id, user_id, event_type, payload_json, created_at)
                VALUES (:room_id, :user_id, :event_type, :payload_json, :created_at)
                RETURNING *
                """
            ),
            {
                "room_id": room_id,
                "user_id": user_id,
                "event_type": event_type,
                "payload_json": json.dumps(payload or {}),
                "created_at": now,
            },
        ).mappings().first()
    return dict(row)


def list_jam_room_events(room_id: str, *, after_id: int | None = None, limit: int = 100) -> list[dict]:
    with transaction_scope() as session:
        if after_id is None:
            rows = session.execute(
                text(
                    """
                    SELECT * FROM jam_room_events
                    WHERE room_id = :room_id
                    ORDER BY id ASC
                    LIMIT :lim
                    """
                ),
                {"room_id": room_id, "lim": limit},
            ).mappings().all()
        else:
            rows = session.execute(
                text(
                    """
                    SELECT * FROM jam_room_events
                    WHERE room_id = :room_id AND id > :after_id
                    ORDER BY id ASC
                    LIMIT :lim
                    """
                ),
                {"room_id": room_id, "after_id": after_id, "lim": limit},
            ).mappings().all()
    return [dict(row) for row in rows]


__all__ = [
    "append_jam_room_event",
    "list_jam_room_events",
]
