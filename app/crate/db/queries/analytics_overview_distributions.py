from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_genre_distribution(limit: int = 30) -> dict[str, int]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT genre, COUNT(*) as c
                FROM library_tracks
                WHERE genre IS NOT NULL AND genre != ''
                GROUP BY genre
                ORDER BY c DESC
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
        return {row["genre"]: row["c"] for row in rows}


def get_decade_distribution() -> dict[str, int]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT (CAST(year AS INTEGER)/10)*10 || 's' as decade, COUNT(*) as c
                FROM library_albums
                WHERE year IS NOT NULL AND year != '' AND length(year) >= 4
                GROUP BY decade ORDER BY decade
                """
            )
        ).mappings().all()
        return {row["decade"]: row["c"] for row in rows}


def get_format_distribution() -> dict[str, int]:
    with read_scope() as session:
        rows = session.execute(
            text("SELECT format, COUNT(*) as c FROM library_tracks WHERE format IS NOT NULL GROUP BY format")
        ).mappings().all()
        return {row["format"]: row["c"] for row in rows}


def get_bitrate_distribution() -> dict[str, int]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    CASE
                        WHEN bitrate IS NULL OR bitrate = 0 THEN 'unknown'
                        WHEN bitrate < 128000 THEN '<128k'
                        WHEN bitrate < 192000 THEN '128-191k'
                        WHEN bitrate < 256000 THEN '192-255k'
                        WHEN bitrate < 320000 THEN '256-319k'
                        WHEN bitrate = 320000 THEN '320k'
                        ELSE '>320k'
                    END as bucket,
                    COUNT(*) as c
                FROM library_tracks GROUP BY 1 ORDER BY 1
                """
            )
        ).mappings().all()
        return {row["bucket"]: row["c"] for row in rows}


def get_sizes_by_format_gb() -> dict[str, float]:
    with read_scope() as session:
        rows = session.execute(
            text("SELECT format, SUM(size) as total FROM library_tracks WHERE format IS NOT NULL GROUP BY format")
        ).mappings().all()
        return {row["format"]: round(row["total"] / (1024**3), 2) for row in rows if row["total"]}


__all__ = [
    "get_bitrate_distribution",
    "get_decade_distribution",
    "get_format_distribution",
    "get_genre_distribution",
    "get_sizes_by_format_gb",
]
