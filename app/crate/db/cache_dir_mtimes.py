"""Directory mtime persistence helpers."""

from __future__ import annotations

import json

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope


def get_dir_mtime(path: str) -> tuple[float, dict | None] | None:
    with read_scope() as session:
        row = session.execute(text("SELECT mtime, data_json FROM dir_mtimes WHERE path = :path"), {"path": path}).mappings().first()
    if not row:
        return None
    data = row["data_json"]
    if isinstance(data, str):
        data = json.loads(data)
    return (row["mtime"], data)


def set_dir_mtime(path: str, mtime: float, data: dict | None = None) -> None:
    with transaction_scope() as session:
        data_json = json.dumps(data) if data is not None else None
        session.execute(
            text(
                "INSERT INTO dir_mtimes (path, mtime, data_json) VALUES (:path, :mtime, :data_json) "
                "ON CONFLICT(path) DO UPDATE SET mtime = EXCLUDED.mtime, data_json = EXCLUDED.data_json"
            ),
            {"path": path, "mtime": mtime, "data_json": data_json},
        )


def get_all_dir_mtimes(prefix: str = "") -> dict[str, tuple[float, dict | None]]:
    with read_scope() as session:
        if prefix:
            rows = session.execute(
                text("SELECT path, mtime, data_json FROM dir_mtimes WHERE path LIKE :prefix"),
                {"prefix": prefix + "%"},
            ).mappings().all()
        else:
            rows = session.execute(text("SELECT path, mtime, data_json FROM dir_mtimes")).mappings().all()
    result = {}
    for row in rows:
        data = row["data_json"]
        if isinstance(data, str):
            data = json.loads(data)
        result[row["path"]] = (row["mtime"], data)
    return result


def delete_dir_mtime(path: str) -> None:
    with transaction_scope() as session:
        session.execute(text("DELETE FROM dir_mtimes WHERE path = :path"), {"path": path})


__all__ = ["delete_dir_mtime", "get_all_dir_mtimes", "get_dir_mtime", "set_dir_mtime"]
