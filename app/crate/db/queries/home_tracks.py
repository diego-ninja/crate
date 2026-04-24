from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_track_candidates_for_album_ids(album_ids: list[int], limit: int = 240) -> list[dict]:
    if not album_ids:
        return []
    capped_ids = album_ids[:30]
    with read_scope() as session:
        session.execute(text("SET LOCAL statement_timeout = '5s'"))
        rows = session.execute(
            text(
                """
                SELECT
                    t.id AS track_id,
                    t.storage_id::text AS track_storage_id,
                    t.path AS track_path,
                    t.title,
                    t.artist,
                    art.id AS artist_id,
                    art.slug AS artist_slug,
                    t.album,
                    alb.id AS album_id,
                    alb.slug AS album_slug,
                    t.duration,
                    t.format,
                    t.bitrate,
                    t.sample_rate,
                    t.bit_depth,
                    COALESCE(t.lastfm_playcount, 0) AS popularity
                FROM library_tracks t
                JOIN library_albums alb ON alb.id = t.album_id
                LEFT JOIN library_artists art ON art.name = t.artist
                WHERE t.album_id = ANY(:album_ids)
                ORDER BY
                    COALESCE(t.lastfm_playcount, 0) DESC,
                    COALESCE(t.track_number, 9999) ASC,
                    t.title ASC
                LIMIT :lim
                """
            ),
            {"album_ids": capped_ids, "lim": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_discovery_track_rows(*, genres: list[str], excluded_artist_names: list[str], limit: int = 240) -> list[dict]:
    if not genres:
        return []
    capped_genres = genres[:20]
    capped_excluded = excluded_artist_names[:50]
    with read_scope() as session:
        session.execute(text("SET LOCAL statement_timeout = '5s'"))
        artist_rows = session.execute(
            text(
                """
                SELECT DISTINCT ag.artist_name
                FROM artist_genres ag
                JOIN genres g ON g.id = ag.genre_id
                WHERE LOWER(g.name) = ANY(:genres)
                  AND NOT (LOWER(ag.artist_name) = ANY(:excluded))
                LIMIT 200
                """
            ),
            {"genres": capped_genres, "excluded": capped_excluded},
        ).mappings().all()
        matching_artists = [r["artist_name"] for r in artist_rows]
        if not matching_artists:
            return []

        rows = session.execute(
            text(
                """
                SELECT
                    t.id AS track_id,
                    t.storage_id::text AS track_storage_id,
                    t.path AS track_path,
                    t.title,
                    t.artist,
                    art.id AS artist_id,
                    art.slug AS artist_slug,
                    t.album,
                    alb.id AS album_id,
                    alb.slug AS album_slug,
                    t.duration,
                    t.format,
                    t.bitrate,
                    t.sample_rate,
                    t.bit_depth,
                    COALESCE(t.lastfm_playcount, 0) AS popularity
                FROM library_tracks t
                JOIN library_albums alb ON alb.id = t.album_id
                LEFT JOIN library_artists art ON art.name = t.artist
                WHERE t.artist = ANY(:artists)
                ORDER BY
                    COALESCE(t.lastfm_playcount, 0) DESC,
                    t.title ASC
                LIMIT :lim
                """
            ),
            {"artists": matching_artists[:100], "lim": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_recent_interest_track_rows(interest_artists_lower: list[str], limit: int = 240) -> list[dict]:
    if not interest_artists_lower:
        return []
    capped_artists = interest_artists_lower[:50]
    with read_scope() as session:
        session.execute(text("SET LOCAL statement_timeout = '5s'"))
        rows = session.execute(
            text(
                """
                SELECT
                    t.id AS track_id,
                    t.storage_id::text AS track_storage_id,
                    t.path AS track_path,
                    t.title,
                    t.artist,
                    art.id AS artist_id,
                    art.slug AS artist_slug,
                    t.album,
                    alb.id AS album_id,
                    alb.slug AS album_slug,
                    t.duration,
                    t.format,
                    t.bitrate,
                    t.sample_rate,
                    t.bit_depth,
                    COALESCE(t.lastfm_playcount, 0) AS popularity
                FROM library_tracks t
                JOIN library_albums alb ON alb.id = t.album_id
                LEFT JOIN library_artists art ON art.name = t.artist
                WHERE LOWER(t.artist) = ANY(:artists)
                ORDER BY
                    alb.updated_at DESC NULLS LAST,
                    COALESCE(t.lastfm_playcount, 0) DESC,
                    COALESCE(t.track_number, 9999) ASC
                LIMIT :lim
                """
            ),
            {"artists": capped_artists, "lim": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_artist_core_track_rows(*, artist_id: int, artist_name: str, limit: int) -> list[dict]:
    with read_scope() as session:
        session.execute(text("SET LOCAL statement_timeout = '5s'"))
        rows = session.execute(
            text(
                """
                SELECT
                    t.id AS track_id,
                    t.storage_id::text AS track_storage_id,
                    t.path AS track_path,
                    t.title,
                    t.artist,
                    art.id AS artist_id,
                    art.slug AS artist_slug,
                    t.album,
                    alb.id AS album_id,
                    alb.slug AS album_slug,
                    t.duration,
                    t.format,
                    t.bitrate,
                    t.sample_rate,
                    t.bit_depth,
                    COALESCE(t.lastfm_playcount, 0) AS popularity,
                    COALESCE(alb.year, '') AS album_year,
                    COALESCE(t.track_number, 9999) AS track_number
                FROM library_tracks t
                LEFT JOIN library_albums alb ON alb.id = t.album_id
                LEFT JOIN library_artists art ON art.name = t.artist
                WHERE art.id = :artist_id OR (art.id IS NULL AND t.artist = :artist_name)
                ORDER BY
                    COALESCE(t.lastfm_playcount, 0) DESC,
                    COALESCE(alb.year, '') DESC,
                    COALESCE(t.track_number, 9999) ASC,
                    t.title ASC
                LIMIT :lim
                """
            ),
            {"artist_id": artist_id, "artist_name": artist_name, "lim": max(limit * 5, 80)},
        ).mappings().all()
    return [dict(row) for row in rows]


__all__ = [
    "get_artist_core_track_rows",
    "get_discovery_track_rows",
    "get_recent_interest_track_rows",
    "get_track_candidates_for_album_ids",
]
