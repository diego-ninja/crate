from __future__ import annotations

from crate.db.queries.home_track_rows import _fetch_rows


def get_recent_interest_track_rows(interest_artists_lower: list[str], limit: int = 240) -> list[dict]:
    if not interest_artists_lower:
        return []
    capped_artists = interest_artists_lower[:50]
    return _fetch_rows(
        """
        SELECT
            t.id AS track_id,
            t.entity_uid::text AS track_entity_uid,
            t.path AS track_path,
            t.title,
            t.artist,
            art.id AS artist_id,
            art.entity_uid::text AS artist_entity_uid,
            art.slug AS artist_slug,
            t.album,
            alb.id AS album_id,
            alb.entity_uid::text AS album_entity_uid,
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
        """,
        {"artists": capped_artists, "lim": limit},
    )


__all__ = ["get_recent_interest_track_rows"]
