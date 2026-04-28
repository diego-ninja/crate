from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_genre_seed_artists(genre_slug: str) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                WITH seed_artists AS (
                    SELECT DISTINCT ag.artist_name
                    FROM artist_genres ag
                    JOIN genres g ON g.id = ag.genre_id
                    WHERE g.slug = :slug
                    UNION
                    SELECT DISTINCT a.artist AS artist_name
                    FROM album_genres alg
                    JOIN genres g ON g.id = alg.genre_id
                    JOIN library_albums a ON a.id = alg.album_id
                    WHERE g.slug = :slug
                )
                SELECT
                    ag.artist_name,
                    MAX(ag.weight)::DOUBLE PRECISION AS weight,
                    MAX(COALESCE(la.listeners, 0))::INTEGER AS listeners
                FROM seed_artists sa
                JOIN artist_genres ag ON ag.artist_name = sa.artist_name
                LEFT JOIN library_artists la ON la.name = ag.artist_name
                GROUP BY ag.artist_name
                ORDER BY MAX(ag.weight) DESC, MAX(COALESCE(la.listeners, 0)) DESC, ag.artist_name ASC
                LIMIT 8
                """
            ),
            {"slug": genre_slug},
        ).mappings().all()
    return [dict(r) for r in rows]


def get_genre_cooccurring_artist_slugs(genre_slug: str) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                WITH seed_artists AS (
                    SELECT DISTINCT ag.artist_name
                    FROM artist_genres ag
                    JOIN genres g ON g.id = ag.genre_id
                    WHERE g.slug = :slug
                    UNION
                    SELECT DISTINCT a.artist AS artist_name
                    FROM album_genres alg
                    JOIN genres g ON g.id = alg.genre_id
                    JOIN library_albums a ON a.id = alg.album_id
                    WHERE g.slug = :slug
                )
                SELECT
                    tn.slug AS canonical_slug,
                    SUM(ag.weight)::DOUBLE PRECISION AS score,
                    COUNT(DISTINCT ag.artist_name)::INTEGER AS hits
                FROM seed_artists sa
                JOIN artist_genres ag ON ag.artist_name = sa.artist_name
                JOIN genres g ON g.id = ag.genre_id
                JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
                JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
                WHERE g.slug <> :slug
                GROUP BY tn.slug
                ORDER BY SUM(ag.weight) DESC, COUNT(DISTINCT ag.artist_name) DESC, tn.slug ASC
                LIMIT 24
                """
            ),
            {"slug": genre_slug},
        ).mappings().all()
    return [dict(r) for r in rows]


def get_genre_cooccurring_album_slugs(genre_slug: str) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                WITH seed_albums AS (
                    SELECT DISTINCT alg.album_id
                    FROM album_genres alg
                    JOIN genres g ON g.id = alg.genre_id
                    WHERE g.slug = :slug
                )
                SELECT
                    tn.slug AS canonical_slug,
                    SUM(alg.weight)::DOUBLE PRECISION AS score,
                    COUNT(DISTINCT alg.album_id)::INTEGER AS hits
                FROM seed_albums sa
                JOIN album_genres alg ON alg.album_id = sa.album_id
                JOIN genres g ON g.id = alg.genre_id
                JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
                JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
                WHERE g.slug <> :slug
                GROUP BY tn.slug
                ORDER BY SUM(alg.weight) DESC, COUNT(DISTINCT alg.album_id) DESC, tn.slug ASC
                LIMIT 24
                """
            ),
            {"slug": genre_slug},
        ).mappings().all()
    return [dict(r) for r in rows]


__all__ = [
    "get_genre_cooccurring_album_slugs",
    "get_genre_cooccurring_artist_slugs",
    "get_genre_seed_artists",
]
