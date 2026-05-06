from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import transaction_scope

_ROOM_GROUP_BY = """
    jr.id,
    jr.host_user_id,
    jr.name,
    jr.status,
    jr.visibility,
    jr.is_permanent,
    jr.description,
    jr.tags,
    jr.current_track_payload,
    jr.created_at,
    jr.ended_at
"""


def create_jam_room(
    host_user_id: int,
    name: str,
    *,
    role: str = "host",
    visibility: str = "private",
    is_permanent: bool = False,
    description: str | None = None,
    tags: list[str] | None = None,
) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    room_id = str(uuid.uuid4())
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                INSERT INTO jam_rooms (id, host_user_id, name, visibility, is_permanent, description, tags, created_at)
                VALUES (:id, :host_user_id, :name, :visibility, :is_permanent, :description, CAST(:tags AS jsonb), :created_at)
                RETURNING *
                """
            ),
            {
                "id": room_id,
                "host_user_id": host_user_id,
                "name": name,
                "visibility": visibility,
                "is_permanent": is_permanent,
                "description": description,
                "tags": json.dumps(tags or []),
                "created_at": now,
            },
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
            text(
                """
                SELECT
                    jr.*,
                    COUNT(DISTINCT jrm.user_id)::int AS member_count,
                    MAX(jre.created_at) AS last_event_at
                FROM jam_rooms jr
                LEFT JOIN jam_room_members jrm ON jrm.room_id = jr.id
                LEFT JOIN jam_room_events jre ON jre.room_id = jr.id
                WHERE jr.id = :id
                GROUP BY
                    jr.id,
                    jr.host_user_id,
                    jr.name,
                    jr.status,
                    jr.visibility,
                    jr.is_permanent,
                    jr.description,
                    jr.tags,
                    jr.current_track_payload,
                    jr.created_at,
                    jr.ended_at
                """
            ),
            {"id": room_id},
        ).mappings().first()
    return dict(row) if row else None


def list_jam_rooms_for_user(user_id: int, *, limit: int = 50, query: str | None = None) -> list[dict]:
    normalized_query = query.strip().lower() if query else ""
    search_clause = ""
    params: dict[str, object] = {"user_id": user_id, "limit": limit}
    if normalized_query:
        search_clause = """
                  AND (
                    lower(jr.name) LIKE :query
                    OR lower(COALESCE(jr.description, '')) LIKE :query
                    OR EXISTS (
                        SELECT 1
                        FROM jsonb_array_elements_text(COALESCE(jr.tags, '[]'::jsonb)) AS room_tag(value)
                        WHERE lower(room_tag.value) LIKE :query
                    )
                  )
        """
        params["query"] = f"%{normalized_query}%"
    with transaction_scope() as session:
        rows = session.execute(
            text(
                f"""
                SELECT
                    jr.*,
                    COUNT(DISTINCT jrm.user_id)::int AS member_count,
                    MAX(jre.created_at) AS last_event_at
                FROM jam_rooms jr
                LEFT JOIN jam_room_members jrm ON jrm.room_id = jr.id
                LEFT JOIN jam_room_events jre ON jre.room_id = jr.id
                WHERE (jr.status = 'active' OR jr.is_permanent = true)
                  AND (
                    jr.visibility = 'public'
                    OR EXISTS (
                        SELECT 1
                        FROM jam_room_members mine
                        WHERE mine.room_id = jr.id
                          AND mine.user_id = :user_id
                    )
                  )
                {search_clause}
                GROUP BY {_ROOM_GROUP_BY}
                ORDER BY (jr.status = 'active') DESC, COALESCE(MAX(jre.created_at), jr.created_at) DESC
                LIMIT :limit
                """
            ),
            params,
        ).mappings().all()
    return [dict(row) for row in rows]


def update_jam_room_settings(
    room_id: str,
    *,
    name: str | None = None,
    visibility: str | None = None,
    is_permanent: bool | None = None,
    description: str | None = None,
    description_provided: bool = False,
    tags: list[str] | None = None,
) -> dict | None:
    fields: list[str] = []
    params: dict[str, object] = {"room_id": room_id}
    idx = 0
    if name is not None:
        fields.append(f"name = :val{idx}")
        params[f"val{idx}"] = name
        idx += 1
    if visibility is not None:
        fields.append(f"visibility = :val{idx}")
        params[f"val{idx}"] = visibility
        idx += 1
    if is_permanent is not None:
        fields.append(f"is_permanent = :val{idx}")
        params[f"val{idx}"] = is_permanent
        idx += 1
    if description_provided:
        fields.append(f"description = :val{idx}")
        params[f"val{idx}"] = description or None
        idx += 1
    if tags is not None:
        fields.append(f"tags = CAST(:val{idx} AS jsonb)")
        params[f"val{idx}"] = json.dumps(tags)
        idx += 1
    if not fields:
        return get_jam_room(room_id)
    with transaction_scope() as session:
        row = session.execute(
            text(f"UPDATE jam_rooms SET {', '.join(fields)} WHERE id = :room_id RETURNING *"),
            params,
        ).mappings().first()
    return get_jam_room(room_id) if row else None


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


def reactivate_permanent_jam_room(room_id: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                UPDATE jam_rooms
                SET status = 'active',
                    ended_at = NULL,
                    current_track_payload = '{}'::jsonb
                WHERE id = :room_id
                  AND is_permanent = true
                RETURNING *
                """
            ),
            {"room_id": room_id},
        ).mappings().first()
    return get_jam_room(room_id) if row else None


def delete_jam_room(room_id: str) -> bool:
    with transaction_scope() as session:
        result = session.execute(
            text("DELETE FROM jam_rooms WHERE id = :room_id"),
            {"room_id": room_id},
        )
    return result.rowcount > 0


__all__ = [
    "create_jam_room",
    "delete_jam_room",
    "get_jam_room",
    "list_jam_rooms_for_user",
    "reactivate_permanent_jam_room",
    "update_jam_room_settings",
    "update_jam_room_state",
]
