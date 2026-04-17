from __future__ import annotations

import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from crate.db.tx import transaction_scope


def create_jam_room(host_user_id: int, name: str, *, role: str = "host") -> dict:
    now = datetime.now(timezone.utc).isoformat()
    room_id = str(uuid.uuid4())
    with transaction_scope() as session:
        row = session.execute(
            text("""
            INSERT INTO jam_rooms (id, host_user_id, name, created_at)
            VALUES (:id, :host_user_id, :name, :created_at)
            RETURNING *
            """),
            {"id": room_id, "host_user_id": host_user_id, "name": name, "created_at": now},
        ).mappings().first()
        room = dict(row)
        session.execute(
            text("""
            INSERT INTO jam_room_members (room_id, user_id, role, joined_at, last_seen_at)
            VALUES (:room_id, :user_id, :role, :joined_at, :last_seen_at)
            ON CONFLICT (room_id, user_id) DO NOTHING
            """),
            {"room_id": room_id, "user_id": host_user_id, "role": role,
             "joined_at": now, "last_seen_at": now},
        )
    return room


def get_jam_room(room_id: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT * FROM jam_rooms WHERE id = :id"),
            {"id": room_id},
        ).mappings().first()
    return dict(row) if row else None


def get_jam_room_members(room_id: str) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
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
            WHERE jrm.room_id = :room_id
            ORDER BY jrm.joined_at ASC
            """),
            {"room_id": room_id},
        ).mappings().all()
        return [dict(row) for row in rows]


def get_jam_room_member(room_id: str, user_id: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text("""
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
            WHERE jrm.room_id = :room_id AND jrm.user_id = :user_id
            LIMIT 1
            """),
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
            text("""
            INSERT INTO jam_room_members (room_id, user_id, role, joined_at, last_seen_at)
            VALUES (:room_id, :user_id, :role, :joined_at, :last_seen_at)
            ON CONFLICT (room_id, user_id) DO UPDATE SET
                role = EXCLUDED.role,
                last_seen_at = EXCLUDED.last_seen_at
            """),
            {"room_id": room_id, "user_id": user_id, "role": role,
             "joined_at": now, "last_seen_at": now},
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


def append_jam_room_event(room_id: str, event_type: str, payload: dict | None = None, user_id: int | None = None) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        row = session.execute(
            text("""
            INSERT INTO jam_room_events (room_id, user_id, event_type, payload_json, created_at)
            VALUES (:room_id, :user_id, :event_type, :payload_json, :created_at)
            RETURNING *
            """),
            {"room_id": room_id, "user_id": user_id, "event_type": event_type,
             "payload_json": json.dumps(payload or {}), "created_at": now},
        ).mappings().first()
        return dict(row)


def list_jam_room_events(room_id: str, *, after_id: int | None = None, limit: int = 100) -> list[dict]:
    with transaction_scope() as session:
        if after_id is None:
            rows = session.execute(
                text("""
                SELECT * FROM jam_room_events
                WHERE room_id = :room_id
                ORDER BY id ASC
                LIMIT :lim
                """),
                {"room_id": room_id, "lim": limit},
            ).mappings().all()
        else:
            rows = session.execute(
                text("""
                SELECT * FROM jam_room_events
                WHERE room_id = :room_id AND id > :after_id
                ORDER BY id ASC
                LIMIT :lim
                """),
                {"room_id": room_id, "after_id": after_id, "lim": limit},
            ).mappings().all()
        return [dict(row) for row in rows]


def update_jam_room_state(room_id: str, *, status: str | None = None, current_track_payload: dict | None = None, ended_at: str | None = None) -> dict | None:
    fields: list[str] = []
    params: dict = {"room_id": room_id}
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


def create_jam_room_invite(room_id: str, created_by: int | None, *, expires_in_hours: int = 24, max_uses: int | None = 20) -> dict:
    token = secrets.token_urlsafe(24)
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(hours=expires_in_hours)).isoformat() if expires_in_hours > 0 else None
    with transaction_scope() as session:
        row = session.execute(
            text("""
            INSERT INTO jam_room_invites (token, room_id, created_by, expires_at, max_uses, created_at)
            VALUES (:token, :room_id, :created_by, :expires_at, :max_uses, :created_at)
            RETURNING *
            """),
            {"token": token, "room_id": room_id, "created_by": created_by,
             "expires_at": expires_at, "max_uses": max_uses, "created_at": now.isoformat()},
        ).mappings().first()
        return dict(row)


def consume_jam_room_invite(token: str) -> dict | None:
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        row = session.execute(
            text("""
            UPDATE jam_room_invites
            SET use_count = use_count + 1
            WHERE token = :token
              AND (expires_at IS NULL OR expires_at > :now)
              AND (max_uses IS NULL OR use_count < max_uses)
            RETURNING *
            """),
            {"token": token, "now": now},
        ).mappings().first()
    return dict(row) if row else None
