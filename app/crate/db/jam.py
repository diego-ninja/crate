from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from psycopg2.extras import Json

from crate.db.core import get_db_ctx


def create_jam_room(host_user_id: int, name: str, *, role: str = "host") -> dict:
    now = datetime.now(timezone.utc).isoformat()
    room_id = str(uuid.uuid4())
    with get_db_ctx() as cur:
        cur.execute(
            """
            INSERT INTO jam_rooms (id, host_user_id, name, created_at)
            VALUES (%s, %s, %s, %s)
            RETURNING *
            """,
            (room_id, host_user_id, name, now),
        )
        room = dict(cur.fetchone())
        cur.execute(
            """
            INSERT INTO jam_room_members (room_id, user_id, role, joined_at, last_seen_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (room_id, user_id) DO NOTHING
            """,
            (room_id, host_user_id, role, now, now),
        )
    return room


def get_jam_room(room_id: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM jam_rooms WHERE id = %s", (room_id,))
        row = cur.fetchone()
    return dict(row) if row else None


def get_jam_room_members(room_id: str) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT
                jrm.room_id,
                jrm.user_id,
                jrm.role,
                jrm.joined_at,
                jrm.last_seen_at,
                u.username,
                u.name AS display_name,
                u.avatar
            FROM jam_room_members jrm
            JOIN users u ON u.id = jrm.user_id
            WHERE jrm.room_id = %s
            ORDER BY jrm.joined_at ASC
            """,
            (room_id,),
        )
        return [dict(row) for row in cur.fetchall()]


def get_jam_room_member(room_id: str, user_id: int) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT
                jrm.room_id,
                jrm.user_id,
                jrm.role,
                jrm.joined_at,
                jrm.last_seen_at,
                u.username,
                u.name AS display_name,
                u.avatar
            FROM jam_room_members jrm
            JOIN users u ON u.id = jrm.user_id
            WHERE jrm.room_id = %s AND jrm.user_id = %s
            LIMIT 1
            """,
            (room_id, user_id),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def is_jam_room_member(room_id: str, user_id: int) -> bool:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT 1 FROM jam_room_members WHERE room_id = %s AND user_id = %s",
            (room_id, user_id),
        )
        return cur.fetchone() is not None


def upsert_jam_room_member(room_id: str, user_id: int, role: str = "collab") -> bool:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            """
            INSERT INTO jam_room_members (room_id, user_id, role, joined_at, last_seen_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (room_id, user_id) DO UPDATE SET
                role = EXCLUDED.role,
                last_seen_at = EXCLUDED.last_seen_at
            """,
            (room_id, user_id, role, now, now),
        )
        return True


def touch_jam_room_member(room_id: str, user_id: int) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE jam_room_members SET last_seen_at = %s WHERE room_id = %s AND user_id = %s",
            (now, room_id, user_id),
        )
        return cur.rowcount > 0


def append_jam_room_event(room_id: str, event_type: str, payload: dict | None = None, user_id: int | None = None) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            """
            INSERT INTO jam_room_events (room_id, user_id, event_type, payload_json, created_at)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
            """,
            (room_id, user_id, event_type, Json(payload or {}), now),
        )
        return dict(cur.fetchone())


def list_jam_room_events(room_id: str, *, after_id: int | None = None, limit: int = 100) -> list[dict]:
    with get_db_ctx() as cur:
        if after_id is None:
            cur.execute(
                """
                SELECT * FROM jam_room_events
                WHERE room_id = %s
                ORDER BY id ASC
                LIMIT %s
                """,
                (room_id, limit),
            )
        else:
            cur.execute(
                """
                SELECT * FROM jam_room_events
                WHERE room_id = %s AND id > %s
                ORDER BY id ASC
                LIMIT %s
                """,
                (room_id, after_id, limit),
            )
        return [dict(row) for row in cur.fetchall()]


def update_jam_room_state(room_id: str, *, status: str | None = None, current_track_payload: dict | None = None, ended_at: str | None = None) -> dict | None:
    fields: list[str] = []
    params: list[object] = []
    if status is not None:
        fields.append("status = %s")
        params.append(status)
    if current_track_payload is not None:
        fields.append("current_track_payload = %s")
        params.append(Json(current_track_payload))
    if ended_at is not None:
        fields.append("ended_at = %s")
        params.append(ended_at)
    if not fields:
        return get_jam_room(room_id)
    params.append(room_id)
    with get_db_ctx() as cur:
        cur.execute(
            f"UPDATE jam_rooms SET {', '.join(fields)} WHERE id = %s RETURNING *",
            params,
        )
        row = cur.fetchone()
    return dict(row) if row else None


def create_jam_room_invite(room_id: str, created_by: int | None, *, expires_in_hours: int = 24, max_uses: int | None = 20) -> dict:
    token = secrets.token_urlsafe(24)
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(hours=expires_in_hours)).isoformat() if expires_in_hours > 0 else None
    with get_db_ctx() as cur:
        cur.execute(
            """
            INSERT INTO jam_room_invites (token, room_id, created_by, expires_at, max_uses, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (token, room_id, created_by, expires_at, max_uses, now.isoformat()),
        )
        return dict(cur.fetchone())


def consume_jam_room_invite(token: str) -> dict | None:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            """
            UPDATE jam_room_invites
            SET use_count = use_count + 1
            WHERE token = %s
              AND (expires_at IS NULL OR expires_at > %s)
              AND (max_uses IS NULL OR use_count < max_uses)
            RETURNING *
            """,
            (token, now),
        )
        row = cur.fetchone()
    return dict(row) if row else None
