"""Artist and album queries for the Subsonic API."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_all_artists_sorted() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT id, name, album_count, COALESCE(listeners, 0) as listeners
                FROM library_artists
                ORDER BY name
                """
            )
        ).mappings().all()
    return [dict(row) for row in rows]


def get_artist_by_id(artist_id: int) -> dict | None:
    with read_scope() as session:
        row = session.execute(
            text("SELECT id, name FROM library_artists WHERE id = :artist_id"),
            {"artist_id": artist_id},
        ).mappings().first()
    return dict(row) if row else None


def get_albums_by_artist_name(artist_name: str) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT id, name, year, track_count, has_cover,
                       COALESCE(total_duration, 0) as duration
                FROM library_albums
                WHERE artist = :artist_name
                ORDER BY year DESC NULLS LAST, name
                """
            ),
            {"artist_name": artist_name},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_album_with_artist(album_id: int) -> dict | None:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT a.id, a.name, a.artist, a.year, a.track_count, a.has_cover,
                       COALESCE(a.total_duration, 0) as duration,
                       ar.id as artist_id
                FROM library_albums a
                LEFT JOIN library_artists ar ON ar.name = a.artist
                WHERE a.id = :album_id
                """
            ),
            {"album_id": album_id},
        ).mappings().first()
    return dict(row) if row else None


def get_album_list(order: str, size: int, offset: int) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                f"""
                SELECT a.id, a.name, a.artist, a.year, a.track_count, a.has_cover,
                       COALESCE(a.total_duration, 0) as duration,
                       ar.id as artist_id
                FROM library_albums a
                LEFT JOIN library_artists ar ON ar.name = a.artist
                ORDER BY {order}
                LIMIT :size OFFSET :offset
                """
            ),
            {"size": size, "offset": offset},
        ).mappings().all()
    return [dict(row) for row in rows]


__all__ = [
    "get_album_list",
    "get_album_with_artist",
    "get_albums_by_artist_name",
    "get_all_artists_sorted",
    "get_artist_by_id",
]
