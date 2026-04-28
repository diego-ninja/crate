"""Planning helpers for music paths."""

from __future__ import annotations

from crate.db.paths_compute import compute_path, resolve_bliss_centroid, resolve_endpoint_label


def resolve_waypoints(waypoints: list[dict] | None) -> tuple[list[list[float]], list[dict]]:
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


def build_music_path_plan(
    origin_type: str,
    origin_value: str,
    dest_type: str,
    dest_value: str,
    *,
    waypoints: list[dict] | None = None,
    step_count: int = 20,
) -> dict | None:
    origin_label = resolve_endpoint_label(origin_type, origin_value)
    dest_label = resolve_endpoint_label(dest_type, dest_value)

    origin_vec = resolve_bliss_centroid(origin_type, origin_value)
    dest_vec = resolve_bliss_centroid(dest_type, dest_value)
    if not origin_vec or not dest_vec:
        return None

    waypoint_vecs, resolved_waypoints = resolve_waypoints(waypoints)
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
        "origin_label": origin_label,
        "dest_label": dest_label,
        "resolved_waypoints": resolved_waypoints,
        "tracks": tracks,
    }


__all__ = [
    "build_music_path_plan",
    "resolve_waypoints",
]
