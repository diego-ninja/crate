"""Stored path row queries."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_music_path_row(path_id: int, user_id: int) -> dict | None:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT id, name, origin_type, origin_value, origin_label,
                       dest_type, dest_value, dest_label, waypoints, step_count,
                       tracks, created_at, updated_at
                FROM music_paths
                WHERE id = :id AND user_id = :user_id
                """
            ),
            {"id": path_id, "user_id": user_id},
        ).mappings().first()
    return dict(row) if row else None


def list_music_path_rows(user_id: int) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT id, name, origin_type, origin_value, origin_label,
                       dest_type, dest_value, dest_label, waypoints, step_count,
                       jsonb_array_length(tracks) AS track_count,
                       created_at, updated_at
                FROM music_paths
                WHERE user_id = :user_id
                ORDER BY created_at DESC
                """
            ),
            {"user_id": user_id},
        ).mappings().all()
    return [dict(row) for row in rows]


__all__ = ["get_music_path_row", "list_music_path_rows"]
