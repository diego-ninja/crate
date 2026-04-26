"""Generator helpers for playlist generation."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def generate_by_genre(genre: str, limit: int = 50) -> list[int]:
    params = {"genre": f"%{genre.strip()}%", "lim": limit}
    genre_relevance = """GREATEST(
        CASE WHEN g.name ILIKE :genre OR g.slug ILIKE :genre THEN COALESCE(ag.weight, 0.0) ELSE 0.0 END,
        COALESCE((
            SELECT MAX(arg.weight)
            FROM artist_genres arg
            JOIN genres g2 ON g2.id = arg.genre_id
            WHERE arg.artist_name = t.artist
              AND (g2.name ILIKE :genre OR g2.slug ILIKE :genre)
        ), 0.0),
        CASE WHEN t.genre ILIKE :genre THEN 1.0 ELSE 0.0 END
    )"""
    with read_scope() as s:
        rows = s.execute(
            text(
                """
                SELECT
                    t.id,
                    MAX("""
                + genre_relevance
                + """) AS genre_relevance,
                    MAX(COALESCE(t.popularity_score, -1)) AS popularity_score
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                LEFT JOIN album_genres ag ON ag.album_id = a.id
                LEFT JOIN genres g ON g.id = ag.genre_id
                WHERE (
                    (g.name ILIKE :genre OR g.slug ILIKE :genre)
                    OR t.genre ILIKE :genre
                    OR EXISTS (
                        SELECT 1
                        FROM artist_genres arg
                        JOIN genres g2 ON g2.id = arg.genre_id
                        WHERE arg.artist_name = t.artist
                          AND (g2.name ILIKE :genre OR g2.slug ILIKE :genre)
                    )
                )
                GROUP BY t.id
                ORDER BY genre_relevance DESC,
                         popularity_score DESC,
                         RANDOM()
                LIMIT :lim
                """
            ),
            params,
        ).mappings().all()
    return [row["id"] for row in rows]


def generate_by_decade(decade: int, limit: int = 50) -> list[int]:
    with read_scope() as s:
        rows = s.execute(
            text(
                """
                SELECT t.id
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                WHERE a.year >= :year_start AND a.year <= :year_end
                ORDER BY RANDOM()
                LIMIT :lim
                """
            ),
            {"year_start": str(decade), "year_end": str(decade + 9), "lim": limit},
        ).mappings().all()
    return [row["id"] for row in rows]


def generate_by_artist(artist_name: str, limit: int = 50) -> list[int]:
    with read_scope() as s:
        rows = s.execute(
            text(
                """
                SELECT t.id
                FROM library_tracks t
                WHERE t.artist = :artist
                ORDER BY t.album_id, t.track_number
                LIMIT :lim
                """
            ),
            {"artist": artist_name, "lim": limit},
        ).mappings().all()
    return [row["id"] for row in rows]


def generate_similar_artists(similar_names: list[str], limit: int = 50) -> list[int]:
    if not similar_names:
        return []
    with read_scope() as s:
        rows = s.execute(
            text(
                """
                SELECT t.id
                FROM library_tracks t
                WHERE t.artist = ANY(:names)
                ORDER BY RANDOM()
                LIMIT :lim
                """
            ),
            {"names": similar_names, "lim": limit},
        ).mappings().all()
    return [row["id"] for row in rows]


def generate_random(limit: int = 50) -> list[int]:
    with read_scope() as s:
        rows = s.execute(
            text("SELECT id FROM library_tracks ORDER BY RANDOM() LIMIT :lim"),
            {"lim": limit},
        ).mappings().all()
    return [row["id"] for row in rows]


__all__ = [
    "generate_by_artist",
    "generate_by_decade",
    "generate_by_genre",
    "generate_random",
    "generate_similar_artists",
]
