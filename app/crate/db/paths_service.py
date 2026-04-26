"""Thin facade for music path service operations."""

from crate.db.paths_service_reads import delete_music_path, get_music_path, list_music_paths
from crate.db.paths_service_writes import create_music_path, preview_music_path, regenerate_music_path


__all__ = [
    "create_music_path",
    "delete_music_path",
    "get_music_path",
    "list_music_paths",
    "preview_music_path",
    "regenerate_music_path",
]
