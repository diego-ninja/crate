from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_artist_all_tracks(artist_name: str) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    t.id, t.title, t.artist, t.album, t.path, t.duration,
                    t.track_number, t.format,
                    a.id as album_id, a.slug as album_slug, a.year,
                    ar.id as artist_id, ar.slug as artist_slug
                FROM library_tracks t
                LEFT JOIN library_albums a ON a.id = t.album_id
                LEFT JOIN library_artists ar ON ar.name = t.artist
                WHERE t.artist = :artist_name
                """
            ),
            {"artist_name": artist_name},
        ).mappings().all()
        return [dict(row) for row in rows]


def get_artist_track_titles_with_albums(artist_name: str) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                "SELECT t.title, t.path, a.name AS album, a.id AS album_id, a.slug AS album_slug "
                "FROM library_tracks t JOIN library_albums a ON t.album_id = a.id "
                "WHERE a.artist = :artist_name ORDER BY t.title"
            ),
            {"artist_name": artist_name},
        ).mappings().all()
        return [dict(row) for row in rows]


def get_artist_setlist_tracks(artist_name: str) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    t.id,
                    t.storage_id::text AS track_storage_id,
                    t.title,
                    t.path,
                    t.album,
                    t.album_id,
                    a.slug AS album_slug,
                    t.duration
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                WHERE a.artist = :artist_name
                ORDER BY a.year NULLS LAST, a.name, t.track_number NULLS LAST, t.title
                """
            ),
            {"artist_name": artist_name},
        ).mappings().all()
        return [dict(row) for row in rows]


__all__ = [
    "get_artist_all_tracks",
    "get_artist_setlist_tracks",
    "get_artist_track_titles_with_albums",
]
