"""Write and preview operations for music path service."""

from __future__ import annotations

from crate.db.paths_service_payloads import build_endpoint_payload
from crate.db.paths_service_planning import build_music_path_plan
from crate.db.paths_service_reads import get_music_path
from crate.db.repositories.paths import create_music_path_record, update_music_path_tracks


def create_music_path(
    user_id: int,
    name: str,
    origin_type: str,
    origin_value: str,
    dest_type: str,
    dest_value: str,
    waypoints: list[dict] | None = None,
    step_count: int = 20,
) -> dict | None:
    plan = build_music_path_plan(
        origin_type,
        origin_value,
        dest_type,
        dest_value,
        waypoints=waypoints,
        step_count=step_count,
    )
    if not plan:
        return None

    row = create_music_path_record(
        user_id=user_id,
        name=name,
        origin_type=origin_type,
        origin_value=origin_value,
        origin_label=plan["origin_label"],
        dest_type=dest_type,
        dest_value=dest_value,
        dest_label=plan["dest_label"],
        waypoints=plan["resolved_waypoints"],
        step_count=step_count,
        tracks=plan["tracks"],
    )
    if not row:
        return None

    return {
        "id": row["id"],
        "name": name,
        "origin": build_endpoint_payload(origin_type, origin_value, plan["origin_label"]),
        "destination": build_endpoint_payload(dest_type, dest_value, plan["dest_label"]),
        "waypoints": plan["resolved_waypoints"],
        "step_count": step_count,
        "tracks": plan["tracks"],
        "created_at": str(row["created_at"]),
    }


def regenerate_music_path(path_id: int, user_id: int) -> dict | None:
    path = get_music_path(path_id, user_id)
    if not path:
        return None

    plan = build_music_path_plan(
        path["origin"]["type"],
        path["origin"]["value"],
        path["destination"]["type"],
        path["destination"]["value"],
        waypoints=path["waypoints"],
        step_count=path["step_count"],
    )
    if not plan:
        return None

    if not update_music_path_tracks(path_id, user_id, plan["tracks"]):
        return None

    path["tracks"] = plan["tracks"]
    return path


def preview_music_path(
    origin_type: str,
    origin_value: str,
    dest_type: str,
    dest_value: str,
    waypoints: list[dict] | None = None,
    step_count: int = 20,
) -> dict | None:
    plan = build_music_path_plan(
        origin_type,
        origin_value,
        dest_type,
        dest_value,
        waypoints=waypoints,
        step_count=step_count,
    )
    if not plan:
        return None

    return {
        "name": f"{plan['origin_label']} -> {plan['dest_label']}",
        "origin": build_endpoint_payload(origin_type, origin_value, plan["origin_label"]),
        "destination": build_endpoint_payload(dest_type, dest_value, plan["dest_label"]),
        "waypoints": plan["resolved_waypoints"],
        "step_count": step_count,
        "tracks": plan["tracks"],
    }


__all__ = [
    "create_music_path",
    "preview_music_path",
    "regenerate_music_path",
]
