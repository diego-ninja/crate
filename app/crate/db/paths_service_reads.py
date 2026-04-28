"""Read-side music path service operations."""

from __future__ import annotations

from crate.db.paths_service_payloads import serialize_music_path_row
from crate.db.queries.paths import get_music_path_row, list_music_path_rows
from crate.db.repositories.paths import delete_music_path as _delete_music_path


def get_music_path(path_id: int, user_id: int) -> dict | None:
    row = get_music_path_row(path_id, user_id)
    if not row:
        return None
    return serialize_music_path_row(dict(row), include_tracks=True)


def list_music_paths(user_id: int) -> list[dict]:
    return [serialize_music_path_row(dict(row), include_tracks=False) for row in list_music_path_rows(user_id)]


def delete_music_path(path_id: int, user_id: int) -> bool:
    return _delete_music_path(path_id, user_id)


__all__ = [
    "delete_music_path",
    "get_music_path",
    "list_music_paths",
]
