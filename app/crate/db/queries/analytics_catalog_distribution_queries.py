from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_insights_countries() -> dict[str, int]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT country, COUNT(*) AS cnt
                FROM library_artists WHERE country IS NOT NULL AND country != ''
                GROUP BY country ORDER BY cnt DESC
                """
            )
        ).mappings().all()
    return {row["country"]: row["cnt"] for row in rows}


def get_insights_format_distribution() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT format, COUNT(*) AS cnt FROM library_tracks
                WHERE format IS NOT NULL GROUP BY format ORDER BY cnt DESC
                """
            )
        ).mappings().all()
    return [{"id": row["format"], "value": row["cnt"]} for row in rows]


def get_insights_albums_by_year() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT year, COUNT(*) AS cnt FROM library_albums
                WHERE year IS NOT NULL AND year != '' GROUP BY year ORDER BY year
                """
            )
        ).mappings().all()
    return [dict(row) for row in rows]


__all__ = [
    "get_insights_albums_by_year",
    "get_insights_countries",
    "get_insights_format_distribution",
]
