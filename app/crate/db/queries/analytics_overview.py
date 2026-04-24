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
        return {r["genre"]: r["c"] for r in rows}


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
        return {r["decade"]: r["c"] for r in rows}


def get_format_distribution() -> dict[str, int]:
    with read_scope() as session:
        rows = session.execute(
            text("SELECT format, COUNT(*) as c FROM library_tracks WHERE format IS NOT NULL GROUP BY format")
        ).mappings().all()
        return {r["format"]: r["c"] for r in rows}


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
        return {r["bucket"]: r["c"] for r in rows}


def get_top_artists_by_albums(limit: int = 25) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT la.id, la.slug, la.name, COUNT(DISTINCT alb.id) AS albums
                FROM library_artists la
                JOIN library_albums alb ON alb.artist = la.name
                GROUP BY la.id, la.slug, la.name
                ORDER BY albums DESC
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
        return [{"id": r["id"], "slug": r["slug"], "name": r["name"], "albums": r["albums"]} for r in rows]


def get_total_duration_hours() -> float:
    with read_scope() as session:
        dur_row = session.execute(text("SELECT COALESCE(SUM(duration), 0) as total FROM library_tracks")).mappings().first()
        return round(dur_row["total"] / 3600, 1) if dur_row["total"] else 0


def get_sizes_by_format_gb() -> dict[str, float]:
    with read_scope() as session:
        rows = session.execute(
            text("SELECT format, SUM(size) as total FROM library_tracks WHERE format IS NOT NULL GROUP BY format")
        ).mappings().all()
        return {r["format"]: round(r["total"] / (1024**3), 2) for r in rows if r["total"]}


def get_avg_tracks_per_album() -> float:
    with read_scope() as session:
        album_count = session.execute(text("SELECT COUNT(*) AS cnt FROM library_albums")).mappings().first()["cnt"]
        track_count = session.execute(text("SELECT COUNT(*) AS cnt FROM library_tracks")).mappings().first()["cnt"]
        return round(track_count / album_count, 1) if album_count else 0


def get_stats_duration_hours() -> float:
    with read_scope() as session:
        row = session.execute(text("SELECT COALESCE(SUM(duration), 0) / 3600.0 AS val FROM library_tracks")).mappings().first()
        return round(row["val"], 1)


def get_stats_avg_bitrate() -> int:
    with read_scope() as session:
        row = session.execute(text("SELECT AVG(bitrate) AS val FROM library_tracks WHERE bitrate IS NOT NULL")).mappings().first()
        return round(row["val"]) if row["val"] else 0


def get_stats_top_genres(limit: int = 10) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT genre, COUNT(*) AS c FROM library_tracks
                WHERE genre IS NOT NULL AND genre != ''
                GROUP BY genre ORDER BY c DESC LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
        return [{"name": r["genre"], "count": r["c"]} for r in rows]


def get_stats_recent_albums(limit: int = 10) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT a.id, a.slug, a.artist, ar.id AS artist_id, ar.slug AS artist_slug, a.name, a.year, a.dir_mtime
                FROM library_albums a
                LEFT JOIN library_artists ar ON ar.name = a.artist
                ORDER BY dir_mtime DESC NULLS LAST LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
        return [dict(r) for r in rows]


def get_stats_analyzed_track_count() -> int:
    with read_scope() as session:
        return session.execute(text("SELECT COUNT(*) AS c FROM library_tracks WHERE bpm IS NOT NULL")).mappings().first()["c"]


def get_stats_avg_album_duration_min() -> float:
    with read_scope() as session:
        row = session.execute(
            text("SELECT AVG(total_duration) AS val FROM library_albums WHERE total_duration IS NOT NULL AND total_duration > 0")
        ).mappings().first()
        return round(row["val"] / 60, 1) if row and row["val"] else 0


def get_timeline_albums() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    a.id,
                    a.slug,
                    a.year,
                    a.artist,
                    ar.id AS artist_id,
                    ar.slug AS artist_slug,
                    a.name,
                    a.track_count
                FROM library_albums a
                LEFT JOIN library_artists ar ON ar.name = a.artist
                WHERE a.year IS NOT NULL AND a.year != ''
                ORDER BY a.year
                """
            )
        ).mappings().all()
        return [dict(r) for r in rows]


__all__ = [
    "get_avg_tracks_per_album",
    "get_bitrate_distribution",
    "get_decade_distribution",
    "get_format_distribution",
    "get_genre_distribution",
    "get_sizes_by_format_gb",
    "get_stats_analyzed_track_count",
    "get_stats_avg_album_duration_min",
    "get_stats_avg_bitrate",
    "get_stats_duration_hours",
    "get_stats_recent_albums",
    "get_stats_top_genres",
    "get_timeline_albums",
    "get_top_artists_by_albums",
    "get_total_duration_hours",
]
