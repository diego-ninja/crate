"""Payload helpers for music path service responses."""

from __future__ import annotations


def build_endpoint_payload(endpoint_type: str, endpoint_value: str, endpoint_label: str) -> dict:
    return {
        "type": endpoint_type,
        "value": endpoint_value,
        "label": endpoint_label,
    }


def serialize_music_path_row(row: dict, *, include_tracks: bool) -> dict:
    payload = {
        "id": row["id"],
        "name": row["name"],
        "origin": build_endpoint_payload(row["origin_type"], row["origin_value"], row["origin_label"]),
        "destination": build_endpoint_payload(row["dest_type"], row["dest_value"], row["dest_label"]),
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


__all__ = [
    "build_endpoint_payload",
    "serialize_music_path_row",
]
