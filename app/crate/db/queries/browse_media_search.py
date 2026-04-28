from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import transaction_scope


def search_artists(like: str, limit: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT id, slug, name, album_count, has_photo
                FROM library_artists
                WHERE name ILIKE :like
                ORDER BY listeners DESC NULLS LAST, album_count DESC, name ASC
                LIMIT :limit
                """
            ),
            {"like": like, "limit": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


def search_albums(like: str, limit: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT a.id, a.slug, a.artist, a.name, a.year, a.has_cover,
                       ar.id AS artist_id, ar.slug AS artist_slug
                FROM library_albums a
                LEFT JOIN library_artists ar ON ar.name = a.artist
                WHERE a.name ILIKE :like OR a.artist ILIKE :like
                ORDER BY year DESC NULLS LAST, name ASC
                LIMIT :limit
                """
            ),
            {"like": like, "limit": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


def search_tracks(like: str, limit: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT t.id, t.storage_id::text, t.slug, t.title, t.artist, a.id AS album_id, a.slug AS album_slug,
                       a.name AS album, ar.id AS artist_id, ar.slug AS artist_slug,
                       t.path, t.duration
                FROM library_tracks t
                JOIN library_albums a ON t.album_id = a.id
                LEFT JOIN library_artists ar ON ar.name = t.artist
                WHERE t.title ILIKE :like OR t.artist ILIKE :like OR a.name ILIKE :like
                ORDER BY t.title ASC
                LIMIT :limit
                """
            ),
            {"like": like, "limit": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


__all__ = [
    "search_albums",
    "search_artists",
    "search_tracks",
]
