"""Search queries for the Subsonic API."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def search_artists(query: str, limit: int) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text("SELECT id, name FROM library_artists WHERE name ILIKE :query LIMIT :limit"),
            {"query": query, "limit": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def search_albums(query: str, limit: int) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT a.id, a.name, a.artist, a.year, a.has_cover, ar.id as artist_id
                FROM library_albums a
                LEFT JOIN library_artists ar ON ar.name = a.artist
                WHERE a.name ILIKE :query
                LIMIT :limit
                """
            ),
            {"query": query, "limit": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def search_tracks(query: str, limit: int) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT t.id, t.title, t.artist, t.album, t.duration, t.path,
                       t.format, t.bitrate, a.id as album_id, a.has_cover, ar.id as artist_id
                FROM library_tracks t
                LEFT JOIN library_albums a ON a.id = t.album_id
                LEFT JOIN library_artists ar ON ar.name = t.artist
                WHERE t.title ILIKE :query OR t.artist ILIKE :query
                LIMIT :limit
                """
            ),
            {"query": query, "limit": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


__all__ = [
    "search_albums",
    "search_artists",
    "search_tracks",
]
