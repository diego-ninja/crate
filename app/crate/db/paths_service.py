"""Music Paths service surface and persistence helpers."""

from __future__ import annotations

from crate.db.paths_compute import compute_path, resolve_bliss_centroid, resolve_endpoint_label
from crate.db.queries.paths import get_music_path_row, list_music_path_rows
from crate.db.repositories.paths import (
    create_music_path_record,
    delete_music_path as _delete_music_path,
    update_music_path_tracks,
)


def _resolve_waypoints(waypoints: list[dict] | None) -> tuple[list[list[float]], list[dict]]:
    waypoint_vecs: list[list[float]] = []
    resolved_waypoints: list[dict] = []
    for waypoint in (waypoints or []):
        waypoint_vec = resolve_bliss_centroid(waypoint["type"], waypoint["value"])
        if waypoint_vec:
            waypoint_vecs.append(waypoint_vec)
            resolved_waypoints.append(
                {
                    **waypoint,
                    "label": resolve_endpoint_label(waypoint["type"], waypoint["value"]),
                }
            )
    return waypoint_vecs, resolved_waypoints


def _serialize_music_path_row(row: dict, *, include_tracks: bool) -> dict:
    payload = {
        "id": row["id"],
        "name": row["name"],
        "origin": {
            "type": row["origin_type"],
            "value": row["origin_value"],
            "label": row["origin_label"],
        },
        "destination": {
            "type": row["dest_type"],
            "value": row["dest_value"],
            "label": row["dest_label"],
        },
        "waypoints": row["waypoints"] or [],
        "step_count": row["step_count"],
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"]),
    }
    if include_tracks:
        payload["tracks"] = row.get("tracks") or []
    else:
        payload["track_count"] = row["track_count"]
    return payload


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
    origin_label = resolve_endpoint_label(origin_type, origin_value)
    dest_label = resolve_endpoint_label(dest_type, dest_value)

    origin_vec = resolve_bliss_centroid(origin_type, origin_value)
    dest_vec = resolve_bliss_centroid(dest_type, dest_value)
    if not origin_vec or not dest_vec:
        return None

    waypoint_vecs, resolved_waypoints = _resolve_waypoints(waypoints)
    tracks = compute_path(
        origin_type,
        origin_value,
        origin_vec,
        dest_type,
        dest_value,
        dest_vec,
        step_count,
        waypoint_vecs or None,
    )

    row = create_music_path_record(
        user_id=user_id,
        name=name,
        origin_type=origin_type,
        origin_value=origin_value,
        origin_label=origin_label,
        dest_type=dest_type,
        dest_value=dest_value,
        dest_label=dest_label,
        waypoints=resolved_waypoints,
        step_count=step_count,
        tracks=tracks,
    )
    if not row:
        return None

    return {
        "id": row["id"],
        "name": name,
        "origin": {"type": origin_type, "value": origin_value, "label": origin_label},
        "destination": {"type": dest_type, "value": dest_value, "label": dest_label},
        "waypoints": resolved_waypoints,
        "step_count": step_count,
        "tracks": tracks,
        "created_at": str(row["created_at"]),
    }


def get_music_path(path_id: int, user_id: int) -> dict | None:
    row = get_music_path_row(path_id, user_id)
    if not row:
        return None
    return _serialize_music_path_row(dict(row), include_tracks=True)


def list_music_paths(user_id: int) -> list[dict]:
    return [_serialize_music_path_row(dict(row), include_tracks=False) for row in list_music_path_rows(user_id)]


def delete_music_path(path_id: int, user_id: int) -> bool:
    return _delete_music_path(path_id, user_id)


def regenerate_music_path(path_id: int, user_id: int) -> dict | None:
    path = get_music_path(path_id, user_id)
    if not path:
        return None

    origin_type = path["origin"]["type"]
    origin_value = path["origin"]["value"]
    dest_type = path["destination"]["type"]
    dest_value = path["destination"]["value"]

    origin_vec = resolve_bliss_centroid(origin_type, origin_value)
    dest_vec = resolve_bliss_centroid(dest_type, dest_value)
    if not origin_vec or not dest_vec:
        return None

    waypoint_vecs, _resolved_waypoints = _resolve_waypoints(path["waypoints"])
    tracks = compute_path(
        origin_type,
        origin_value,
        origin_vec,
        dest_type,
        dest_value,
        dest_vec,
        path["step_count"],
        waypoint_vecs or None,
    )

    if not update_music_path_tracks(path_id, user_id, tracks):
        return None

    path["tracks"] = tracks
    return path


def preview_music_path(
    origin_type: str,
    origin_value: str,
    dest_type: str,
    dest_value: str,
    waypoints: list[dict] | None = None,
    step_count: int = 20,
) -> dict | None:
    origin_vec = resolve_bliss_centroid(origin_type, origin_value)
    dest_vec = resolve_bliss_centroid(dest_type, dest_value)
    if not origin_vec or not dest_vec:
        return None

    origin_label = resolve_endpoint_label(origin_type, origin_value)
    dest_label = resolve_endpoint_label(dest_type, dest_value)
    waypoint_vecs, resolved_waypoints = _resolve_waypoints(waypoints)
    tracks = compute_path(
        origin_type,
        origin_value,
        origin_vec,
        dest_type,
        dest_value,
        dest_vec,
        step_count,
        waypoint_vecs or None,
    )

    return {
        "name": f"{origin_label} -> {dest_label}",
        "origin": {"type": origin_type, "value": origin_value, "label": origin_label},
        "destination": {"type": dest_type, "value": dest_value, "label": dest_label},
        "waypoints": resolved_waypoints,
        "step_count": step_count,
        "tracks": tracks,
    }


__all__ = [
    "create_music_path",
    "delete_music_path",
    "get_music_path",
    "list_music_paths",
    "preview_music_path",
    "regenerate_music_path",
]
