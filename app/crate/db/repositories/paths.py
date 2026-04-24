"""Write-side persistence for music paths."""

import json
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import transaction_scope


def create_music_path_record(
    *,
    user_id: int,
    name: str,
    origin_type: str,
    origin_value: str,
    origin_label: str,
    dest_type: str,
    dest_value: str,
    dest_label: str,
    waypoints: list[dict],
    step_count: int,
    tracks: list[dict],
) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                INSERT INTO music_paths
                    (user_id, name, origin_type, origin_value, origin_label,
                     dest_type, dest_value, dest_label, waypoints, step_count, tracks)
                VALUES
                    (:user_id, :name, :origin_type, :origin_value, :origin_label,
                     :dest_type, :dest_value, :dest_label, CAST(:waypoints AS jsonb), :step_count, CAST(:tracks AS jsonb))
                RETURNING id, created_at
                """
            ),
            {
                "user_id": user_id,
                "name": name,
                "origin_type": origin_type,
                "origin_value": origin_value,
                "origin_label": origin_label,
                "dest_type": dest_type,
                "dest_value": dest_value,
                "dest_label": dest_label,
                "waypoints": json.dumps(waypoints),
                "step_count": step_count,
                "tracks": json.dumps(tracks),
            },
        ).mappings().first()
    return dict(row) if row else None


def delete_music_path(path_id: int, user_id: int) -> bool:
    with transaction_scope() as session:
        result = session.execute(
            text("DELETE FROM music_paths WHERE id = :id AND user_id = :user_id"),
            {"id": path_id, "user_id": user_id},
        )
        return result.rowcount > 0


def update_music_path_tracks(path_id: int, user_id: int, tracks: list[dict]) -> bool:
    with transaction_scope() as session:
        result = session.execute(
            text(
                """
                UPDATE music_paths
                SET tracks = CAST(:tracks AS jsonb), updated_at = :now
                WHERE id = :id AND user_id = :user_id
                """
            ),
            {
                "id": path_id,
                "user_id": user_id,
                "tracks": json.dumps(tracks),
                "now": datetime.now(timezone.utc),
            },
        )
        return result.rowcount > 0


__all__ = [
    "create_music_path_record",
    "delete_music_path",
    "update_music_path_tracks",
]
