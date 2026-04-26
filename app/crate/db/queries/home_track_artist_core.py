from __future__ import annotations

from crate.db.queries.home_track_rows import _fetch_rows


def get_artist_core_track_rows(*, artist_id: int, artist_name: str, limit: int) -> list[dict]:
    return _fetch_rows(
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
        """,
        {"artist_id": artist_id, "artist_name": artist_name, "lim": max(limit * 5, 80)},
    )


__all__ = ["get_artist_core_track_rows"]
