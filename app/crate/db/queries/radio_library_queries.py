"""Library/object lookup queries for the shaped radio engine."""

from __future__ import annotations

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


def get_random_library_vectors(limit: int = 30) -> list[list[float]]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT t.bliss_vector
                FROM library_tracks t
                WHERE t.bliss_vector IS NOT NULL
                ORDER BY RANDOM()
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
    return [list(row["bliss_vector"]) for row in rows]


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
    "get_random_library_vectors",
    "get_track_bliss_vector",
    "get_track_path_by_id",
    "get_track_path_by_pattern",
]
