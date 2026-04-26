from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import transaction_scope


def create_jam_room(host_user_id: int, name: str, *, role: str = "host") -> dict:
    now = datetime.now(timezone.utc).isoformat()
    room_id = str(uuid.uuid4())
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                INSERT INTO jam_rooms (id, host_user_id, name, created_at)
                VALUES (:id, :host_user_id, :name, :created_at)
                RETURNING *
                """
            ),
            {"id": room_id, "host_user_id": host_user_id, "name": name, "created_at": now},
        ).mappings().first()
        room = dict(row)
        session.execute(
            text(
                """
                INSERT INTO jam_room_members (room_id, user_id, role, joined_at, last_seen_at)
                VALUES (:room_id, :user_id, :role, :joined_at, :last_seen_at)
                ON CONFLICT (room_id, user_id) DO NOTHING
                """
            ),
            {
                "room_id": room_id,
                "user_id": host_user_id,
                "role": role,
                "joined_at": now,
                "last_seen_at": now,
            },
        )
    return room


def get_jam_room(room_id: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT * FROM jam_rooms WHERE id = :id"),
            {"id": room_id},
        ).mappings().first()
    return dict(row) if row else None


def update_jam_room_state(
    room_id: str,
    *,
    status: str | None = None,
    current_track_payload: dict | None = None,
    ended_at: str | None = None,
) -> dict | None:
    fields: list[str] = []
    params: dict[str, object] = {"room_id": room_id}
    idx = 0
    if status is not None:
        fields.append(f"status = :val{idx}")
        params[f"val{idx}"] = status
        idx += 1
    if current_track_payload is not None:
        fields.append(f"current_track_payload = :val{idx}")
        params[f"val{idx}"] = json.dumps(current_track_payload)
        idx += 1
    if ended_at is not None:
        fields.append(f"ended_at = :val{idx}")
        params[f"val{idx}"] = ended_at
        idx += 1
    if not fields:
        return get_jam_room(room_id)
    with transaction_scope() as session:
        row = session.execute(
            text(f"UPDATE jam_rooms SET {', '.join(fields)} WHERE id = :room_id RETURNING *"),
            params,
        ).mappings().first()
    return dict(row) if row else None


__all__ = [
    "create_jam_room",
    "get_jam_room",
    "update_jam_room_state",
]
