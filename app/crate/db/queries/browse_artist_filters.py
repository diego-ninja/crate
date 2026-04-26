from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_browse_filter_genres(country: str = "", decade: str = "", format: str = "") -> list[dict]:
    where_clauses = ["1=1"]
    params: dict[str, str | int] = {}

    if country:
        where_clauses.append("la.country = :country")
        params["country"] = country

    if decade:
        try:
            decade_start = int(decade.rstrip("s"))
            where_clauses.append("la.formed IS NOT NULL AND length(la.formed) >= 4")
            where_clauses.append("CAST(substring(la.formed, 1, 4) AS INTEGER) BETWEEN :decade_start AND :decade_end")
            params["decade_start"] = decade_start
            params["decade_end"] = decade_start + 9
        except (ValueError, TypeError):
            pass

    if format:
        where_clauses.append("la.primary_format = :format")
        params["format"] = format

    where_sql = " AND ".join(where_clauses)

    with read_scope() as session:
        rows = session.execute(
            text(
                f"""
                SELECT g.name, COUNT(DISTINCT la.name) AS cnt
                FROM library_artists la
                JOIN artist_genres ag ON la.name = ag.artist_name
                JOIN genres g ON g.id = ag.genre_id
                WHERE {where_sql}
                GROUP BY g.name
                HAVING COUNT(DISTINCT la.name) >= 1
                ORDER BY cnt DESC, g.name ASC
                LIMIT 200
                """
            ),
            params,
        ).mappings().all()
        return [{"name": row["name"], "cnt": row["cnt"]} for row in rows]


def get_browse_filter_countries() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT country, COUNT(*) AS cnt FROM library_artists
                WHERE country IS NOT NULL AND country != ''
                GROUP BY country ORDER BY cnt DESC
                """
            )
        ).mappings().all()
        return [{"name": row["country"], "count": row["cnt"]} for row in rows]


def get_browse_filter_decades() -> list[str]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT DISTINCT formed FROM library_artists
                WHERE formed IS NOT NULL AND formed != '' AND length(formed) >= 4
                """
            )
        ).mappings().all()
        decades_set = set()
        for row in rows:
            try:
                decade = f"{int(row['formed'][:4]) // 10 * 10}s"
                decades_set.add(decade)
            except (ValueError, TypeError):
                pass
        return sorted(decades_set)


def get_browse_filter_formats() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT format, COUNT(*) AS cnt FROM library_tracks
                WHERE format IS NOT NULL GROUP BY format ORDER BY cnt DESC
                """
            )
        ).mappings().all()
        return [{"name": row["format"], "count": row["cnt"]} for row in rows]


__all__ = [
    "get_browse_filter_countries",
    "get_browse_filter_decades",
    "get_browse_filter_formats",
    "get_browse_filter_genres",
]
