from __future__ import annotations

from crate.db.queries.home_track_rows import _fetch_rows


def get_track_candidates_for_album_ids(album_ids: list[int], limit: int = 240) -> list[dict]:
    if not album_ids:
        return []
    capped_ids = album_ids[:30]
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
        WHERE t.album_id = ANY(:album_ids)
        ORDER BY
            COALESCE(t.lastfm_playcount, 0) DESC,
            COALESCE(t.track_number, 9999) ASC,
            t.title ASC
        LIMIT :lim
        """,
        {"album_ids": capped_ids, "lim": limit},
    )


__all__ = ["get_track_candidates_for_album_ids"]
