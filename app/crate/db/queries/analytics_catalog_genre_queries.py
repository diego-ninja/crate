from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_insights_top_genres(limit: int = 20) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT g.name, COUNT(DISTINCT ag.artist_name) AS artists, COUNT(DISTINCT alg.album_id) AS albums
                FROM genres g
                LEFT JOIN artist_genres ag ON g.id = ag.genre_id
                LEFT JOIN album_genres alg ON g.id = alg.genre_id
                GROUP BY g.id, g.name
                HAVING COUNT(DISTINCT ag.artist_name) > 0
                ORDER BY COUNT(DISTINCT ag.artist_name) DESC LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
    return [{"genre": row["name"], "artists": row["artists"], "albums": row["albums"]} for row in rows]


def get_insights_top_albums(limit: int = 20) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT name, artist, lastfm_listeners, popularity, popularity_score, year
                FROM library_albums
                WHERE (popularity_score IS NOT NULL AND popularity_score > 0)
                   OR (lastfm_listeners IS NOT NULL AND lastfm_listeners > 0)
                ORDER BY popularity_score DESC NULLS LAST, lastfm_listeners DESC NULLS LAST
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


__all__ = [
    "get_insights_top_albums",
    "get_insights_top_genres",
]
