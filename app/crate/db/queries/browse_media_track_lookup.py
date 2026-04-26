from __future__ import annotations

import re

from sqlalchemy import text

from crate.db.tx import transaction_scope

_track_path_cache: dict[int, str] = {}
_TRACK_PATH_CACHE_MAX = 4096


def find_track_id_by_path(path_like: str) -> int | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT id FROM library_tracks WHERE path LIKE :path_like LIMIT 1"), {"path_like": f"%{path_like}"}).mappings().first()
        return row["id"] if row else None


def _validate_cols(cols: str) -> str:
    if not re.match(r"^[a-z_,\s]+$", cols):
        raise ValueError(f"Invalid column list: {cols!r}")
    return cols


def get_track_info_cols(track_id: int, cols: str) -> dict | None:
    _validate_cols(cols)
    with transaction_scope() as session:
        row = session.execute(text(f"SELECT {cols} FROM library_tracks WHERE id = :track_id"), {"track_id": track_id}).mappings().first()
        return dict(row) if row else None


def get_track_info_cols_by_storage_id(storage_id: str, cols: str) -> dict | None:
    _validate_cols(cols)
    with transaction_scope() as session:
        row = session.execute(text(f"SELECT {cols} FROM library_tracks WHERE storage_id = :storage_id"), {"storage_id": storage_id}).mappings().first()
        return dict(row) if row else None


def get_track_info_cols_by_path(filepath: str, cols: str) -> dict | None:
    _validate_cols(cols)
    with transaction_scope() as session:
        row = session.execute(
            text(f"SELECT {cols} FROM library_tracks WHERE path LIKE :filepath LIMIT 1"),
            {"filepath": f"%{filepath}"},
        ).mappings().first()
        return dict(row) if row else None


def get_track_exists(track_id: int) -> bool:
    with transaction_scope() as session:
        row = session.execute(text("SELECT 1 FROM library_tracks WHERE id = :track_id"), {"track_id": track_id}).mappings().first()
        return row is not None


def get_track_id_by_storage_id(storage_id: str) -> int | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT id FROM library_tracks WHERE storage_id = :storage_id"), {"storage_id": storage_id}).mappings().first()
        return row["id"] if row else None


def get_track_path(track_id: int) -> str | None:
    cached = _track_path_cache.get(track_id)
    if cached is not None:
        return cached
    with transaction_scope() as session:
        row = session.execute(text("SELECT path FROM library_tracks WHERE id = :track_id"), {"track_id": track_id}).mappings().first()
        path = row["path"] if row else None
    if path and len(_track_path_cache) < _TRACK_PATH_CACHE_MAX:
        _track_path_cache[track_id] = path
    return path


def clear_track_path_cache():
    _track_path_cache.clear()


def get_track_path_by_storage_id(storage_id: str) -> str | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT path FROM library_tracks WHERE storage_id = :storage_id"), {"storage_id": storage_id}).mappings().first()
        return row["path"] if row else None


__all__ = [
    "clear_track_path_cache",
    "find_track_id_by_path",
    "get_track_exists",
    "get_track_id_by_storage_id",
    "get_track_info_cols",
    "get_track_info_cols_by_path",
    "get_track_info_cols_by_storage_id",
    "get_track_path",
    "get_track_path_by_storage_id",
]
