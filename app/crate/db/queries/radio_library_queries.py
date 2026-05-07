"""Library/object lookup queries for the shaped radio engine."""

from __future__ import annotations

import random

from sqlalchemy import text

from crate.db.tx import read_scope


def get_track_path_by_id(track_id: int) -> str | None:
    with read_scope() as session:
        row = session.execute(
            text("SELECT path FROM library_tracks WHERE id = :track_id LIMIT 1"),
            {"track_id": track_id},
        ).mappings().first()
    return str(row["path"]) if row and row.get("path") else None


def get_track_path_by_pattern(path: str, escaped_like: str) -> str | None:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT path
                FROM library_tracks
                WHERE path = :path
                LIMIT 1
                """
            ),
            {"path": path, "escaped_like": escaped_like},
        ).mappings().first()
    return str(row["path"]) if row and row.get("path") else None


def get_album_for_radio(album_id: int) -> dict | None:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT id, artist, name
                FROM library_albums
                WHERE id = :album_id
                LIMIT 1
                """
            ),
            {"album_id": album_id},
        ).mappings().first()
    return dict(row) if row else None


def get_playlist_for_radio(playlist_id: int) -> dict | None:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT id, name, scope, user_id, is_active
                FROM playlists
                WHERE id = :playlist_id
                LIMIT 1
                """
            ),
            {"playlist_id": playlist_id},
        ).mappings().first()
    return dict(row) if row else None


def get_random_library_seed_rows(limit: int = 30) -> list[dict]:
    with read_scope() as session:
        max_row = session.execute(
            text(
                """
                SELECT MAX(id)::INTEGER AS max_id
                FROM library_tracks
                WHERE bliss_vector IS NOT NULL
                """
            )
        ).mappings().first()
        max_id = int(max_row["max_id"] or 0) if max_row else 0
        if max_id <= 0:
            return []

        start_id = random.randint(1, max_id)
        rows = session.execute(
            text(
                """
                SELECT t.id AS track_id, t.artist, t.bliss_vector
                FROM library_tracks t
                WHERE t.bliss_vector IS NOT NULL
                  AND t.id >= :start_id
                ORDER BY t.id
                LIMIT :limit
                """
            ),
            {"limit": limit, "start_id": start_id},
        ).mappings().all()
        if len(rows) < limit:
            rows = list(rows) + session.execute(
                text(
                    """
                    SELECT t.id AS track_id, t.artist, t.bliss_vector
                    FROM library_tracks t
                    WHERE t.bliss_vector IS NOT NULL
                      AND t.id < :start_id
                    ORDER BY t.id
                    LIMIT :remaining
                    """
                ),
                {"remaining": limit - len(rows), "start_id": start_id},
            ).mappings().all()
    return [dict(row) for row in rows]


def get_random_library_vectors(limit: int = 30) -> list[list[float]]:
    return [list(row["bliss_vector"]) for row in get_random_library_seed_rows(limit)]


def get_track_bliss_vector(track_id: int) -> list[float] | None:
    with read_scope() as session:
        row = session.execute(
            text("SELECT bliss_vector FROM library_tracks WHERE id = :id AND bliss_vector IS NOT NULL"),
            {"id": track_id},
        ).mappings().first()
    return list(row["bliss_vector"]) if row else None


__all__ = [
    "get_album_for_radio",
    "get_playlist_for_radio",
    "get_random_library_seed_rows",
    "get_random_library_vectors",
    "get_track_bliss_vector",
    "get_track_path_by_id",
    "get_track_path_by_pattern",
]
