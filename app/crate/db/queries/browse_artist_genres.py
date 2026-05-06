from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_artist_list_genres(artist_name: str) -> list[str]:
    with read_scope() as session:
        rows = session.execute(
            text(
                "SELECT g.name FROM artist_genres ag JOIN genres g ON ag.genre_id = g.id "
                "WHERE ag.artist_name = :artist_name ORDER BY ag.weight DESC LIMIT 5"
            ),
            {"artist_name": artist_name},
        ).mappings().all()
        return [row["name"] for row in rows]


def get_artist_list_genres_map(artist_names: list[str], limit: int = 5) -> dict[str, list[str]]:
    if not artist_names:
        return {}

    with read_scope() as session:
        rows = session.execute(
            text(
                """
                WITH ranked AS (
                    SELECT
                        ag.artist_name,
                        g.name,
                        ROW_NUMBER() OVER (
                            PARTITION BY ag.artist_name
                            ORDER BY ag.weight DESC NULLS LAST, g.name ASC
                        ) AS genre_rank
                    FROM artist_genres ag
                    JOIN genres g ON ag.genre_id = g.id
                    WHERE ag.artist_name = ANY(:artist_names)
                )
                SELECT artist_name, name
                FROM ranked
                WHERE genre_rank <= :limit
                ORDER BY artist_name ASC, genre_rank ASC
                """
            ),
            {"artist_names": artist_names, "limit": limit},
        ).mappings().all()

    genre_map = {artist_name: [] for artist_name in artist_names}
    for row in rows:
        genre_map.setdefault(row["artist_name"], []).append(row["name"])
    return genre_map


def get_artist_genres_by_name(artist_name: str, limit: int = 5) -> list[str]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT g.name
                FROM artist_genres ag
                JOIN genres g ON g.id = ag.genre_id
                WHERE ag.artist_name = :artist_name
                ORDER BY ag.weight DESC
                LIMIT :limit
                """
            ),
            {"artist_name": artist_name, "limit": limit},
        ).mappings().all()
        return [row["name"] for row in rows]


def get_artist_top_genres(artist_name: str) -> list[str]:
    with read_scope() as session:
        rows = session.execute(
            text(
                "SELECT g.name FROM artist_genres ag JOIN genres g ON ag.genre_id = g.id "
                "WHERE ag.artist_name = :artist_name ORDER BY ag.weight DESC"
            ),
            {"artist_name": artist_name},
        ).mappings().all()
        return [row["name"] for row in rows]


def get_artist_genre_profile(artist_name: str, limit: int = 8) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT g.name, g.slug, ag.weight, ag.source
                FROM artist_genres ag
                JOIN genres g ON g.id = ag.genre_id
                WHERE ag.artist_name = :artist_name
                ORDER BY ag.weight DESC NULLS LAST, g.name ASC
                LIMIT :limit
                """
            ),
            {"artist_name": artist_name, "limit": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


def get_all_artist_genre_map() -> dict[str, list[str]]:
    genre_map: dict[str, list[str]] = {}
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT ag.artist_name, g.name FROM artist_genres ag
                JOIN genres g ON ag.genre_id = g.id ORDER BY ag.weight DESC
                """
            )
        ).mappings().all()
        for row in rows:
            genre_map.setdefault(row["artist_name"], []).append(row["name"])
    return genre_map


def get_all_artist_genre_map_for_shows() -> dict[str, list[str]]:
    """Same query as get_all_artist_genre_map, used in upcoming endpoint."""
    return get_all_artist_genre_map()


__all__ = [
    "get_all_artist_genre_map",
    "get_all_artist_genre_map_for_shows",
    "get_artist_genre_profile",
    "get_artist_genres_by_name",
    "get_artist_list_genres",
    "get_artist_list_genres_map",
    "get_artist_top_genres",
]
