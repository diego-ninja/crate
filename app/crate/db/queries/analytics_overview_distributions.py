from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_track_distribution_summary(genre_limit: int = 30) -> dict[str, dict]:
    """Return track distributions from one base-table scan.

    The CTE is materialized deliberately: admin snapshots need several
    catalog rollups, but they should not re-read library_tracks once per
    chart.
    """
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                WITH track_rollups AS MATERIALIZED (
                    SELECT
                        genre,
                        format,
                        size,
                        CASE
                            WHEN bitrate IS NULL OR bitrate = 0 THEN 'unknown'
                            WHEN bitrate < 128000 THEN '<128k'
                            WHEN bitrate < 192000 THEN '128-191k'
                            WHEN bitrate < 256000 THEN '192-255k'
                            WHEN bitrate < 320000 THEN '256-319k'
                            WHEN bitrate = 320000 THEN '320k'
                            ELSE '>320k'
                        END AS bitrate_bucket
                    FROM library_tracks
                ),
                genre_rows AS (
                    SELECT
                        'genre' AS kind,
                        genre AS label,
                        COUNT(*) AS count_value,
                        NULL::DOUBLE PRECISION AS size_value,
                        ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, genre ASC) AS rank
                    FROM track_rollups
                    WHERE genre IS NOT NULL AND genre != ''
                    GROUP BY genre
                ),
                format_rows AS (
                    SELECT
                        'format' AS kind,
                        format AS label,
                        COUNT(*) AS count_value,
                        NULL::DOUBLE PRECISION AS size_value,
                        1 AS rank
                    FROM track_rollups
                    WHERE format IS NOT NULL
                    GROUP BY format
                ),
                bitrate_rows AS (
                    SELECT
                        'bitrate' AS kind,
                        bitrate_bucket AS label,
                        COUNT(*) AS count_value,
                        NULL::DOUBLE PRECISION AS size_value,
                        1 AS rank
                    FROM track_rollups
                    GROUP BY bitrate_bucket
                ),
                size_rows AS (
                    SELECT
                        'size_by_format' AS kind,
                        format AS label,
                        COUNT(*) AS count_value,
                        SUM(size)::DOUBLE PRECISION AS size_value,
                        1 AS rank
                    FROM track_rollups
                    WHERE format IS NOT NULL
                    GROUP BY format
                )
                SELECT kind, label, count_value, size_value
                FROM (
                    SELECT * FROM genre_rows WHERE rank <= :genre_limit
                    UNION ALL
                    SELECT * FROM format_rows
                    UNION ALL
                    SELECT * FROM bitrate_rows
                    UNION ALL
                    SELECT * FROM size_rows
                ) rows
                ORDER BY kind, count_value DESC, label
                """
            ),
            {"genre_limit": genre_limit},
        ).mappings().all()

    summary: dict[str, dict] = {
        "genres": {},
        "formats": {},
        "bitrates": {},
        "sizes_by_format_gb": {},
    }
    for row in rows:
        kind = row["kind"]
        label = row["label"]
        if not label:
            continue
        if kind == "genre":
            summary["genres"][label] = int(row["count_value"] or 0)
        elif kind == "format":
            summary["formats"][label] = int(row["count_value"] or 0)
        elif kind == "bitrate":
            summary["bitrates"][label] = int(row["count_value"] or 0)
        elif kind == "size_by_format":
            summary["sizes_by_format_gb"][label] = round(float(row["size_value"] or 0) / (1024**3), 2)
    return summary


def get_genre_distribution(limit: int = 30) -> dict[str, int]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT genre, COUNT(*) as c
                FROM library_tracks
                WHERE genre IS NOT NULL AND genre != ''
                GROUP BY genre ORDER BY c DESC LIMIT :limit
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
                    END AS bucket,
                    COUNT(*) AS c
                FROM library_tracks
                GROUP BY bucket
                """
            )
        ).mappings().all()
        return {row["bucket"]: row["c"] for row in rows}


def get_sizes_by_format_gb() -> dict[str, float]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT format, SUM(size) AS bytes
                FROM library_tracks
                WHERE format IS NOT NULL
                GROUP BY format
                """
            )
        ).mappings().all()
        return {row["format"]: round((row["bytes"] or 0) / (1024**3), 2) for row in rows}


__all__ = [
    "get_bitrate_distribution",
    "get_decade_distribution",
    "get_format_distribution",
    "get_genre_distribution",
    "get_sizes_by_format_gb",
    "get_track_distribution_summary",
]
