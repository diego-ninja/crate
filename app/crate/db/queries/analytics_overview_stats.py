from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


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
        return [{"id": row["id"], "slug": row["slug"], "name": row["name"], "albums": row["albums"]} for row in rows]


def get_total_duration_hours() -> float:
    with read_scope() as session:
        row = session.execute(text("SELECT COALESCE(SUM(duration), 0) as total FROM library_tracks")).mappings().first()
        return round(row["total"] / 3600, 1) if row["total"] else 0


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
        return [{"name": row["genre"], "count": row["c"]} for row in rows]


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
        return [dict(row) for row in rows]


def get_stats_analyzed_track_count() -> int:
    with read_scope() as session:
        row = session.execute(text("SELECT COUNT(*) AS c FROM library_tracks WHERE bpm IS NOT NULL")).mappings().first()
        return row["c"]


def get_stats_avg_album_duration_min() -> float:
    with read_scope() as session:
        row = session.execute(
            text("SELECT AVG(total_duration) AS val FROM library_albums WHERE total_duration IS NOT NULL AND total_duration > 0")
        ).mappings().first()
        return round(row["val"] / 60, 1) if row and row["val"] else 0


__all__ = [
    "get_avg_tracks_per_album",
    "get_stats_analyzed_track_count",
    "get_stats_avg_album_duration_min",
    "get_stats_avg_bitrate",
    "get_stats_duration_hours",
    "get_stats_recent_albums",
    "get_stats_top_genres",
    "get_top_artists_by_albums",
    "get_total_duration_hours",
]
