from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import transaction_scope


def get_track_album_genres(track_id: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT g.name, g.slug, ag.weight
                FROM library_tracks t
                JOIN album_genres ag ON ag.album_id = t.album_id
                JOIN genres g ON g.id = ag.genre_id
                WHERE t.id = :track_id
                ORDER BY ag.weight DESC NULLS LAST, g.name ASC
                LIMIT 10
                """
            ),
            {"track_id": track_id},
        ).mappings().all()
        return [dict(row) for row in rows]


def get_track_artist_genres(track_id: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT g.name, g.slug, arg.weight
                FROM library_tracks t
                JOIN artist_genres arg ON arg.artist_name = t.artist
                JOIN genres g ON g.id = arg.genre_id
                WHERE t.id = :track_id
                ORDER BY arg.weight DESC NULLS LAST, g.name ASC
                LIMIT 10
                """
            ),
            {"track_id": track_id},
        ).mappings().all()
        return [dict(row) for row in rows]


__all__ = [
    "get_track_album_genres",
    "get_track_artist_genres",
]
