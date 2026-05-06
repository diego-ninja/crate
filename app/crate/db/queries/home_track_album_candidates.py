from __future__ import annotations

from crate.db.queries.home_track_rows import _fetch_rows


def get_track_candidates_for_album_ids(*, user_id: int, album_ids: list[int], limit: int = 240) -> list[dict]:
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
            t.bpm,
            t.audio_key,
            t.audio_scale,
            t.energy,
            t.danceability,
            t.valence,
            t.bliss_vector,
            COALESCE(t.lastfm_playcount, 0) AS popularity,
            COALESCE(uts.play_count, 0) AS user_play_count,
            (ult.track_id IS NOT NULL) AS is_liked
        FROM library_tracks t
        JOIN library_albums alb ON alb.id = t.album_id
        LEFT JOIN library_artists art ON art.name = t.artist
        LEFT JOIN user_track_stats uts
          ON uts.user_id = :user_id
         AND uts.stat_window = '90d'
         AND uts.track_id = t.id
        LEFT JOIN user_liked_tracks ult
          ON ult.user_id = :user_id
         AND ult.track_id = t.id
        WHERE t.album_id = ANY(:album_ids)
        ORDER BY
            COALESCE(t.lastfm_playcount, 0) DESC,
            COALESCE(t.track_number, 9999) ASC,
            t.title ASC
        LIMIT :lim
        """,
        {"user_id": user_id, "album_ids": capped_ids, "lim": limit},
    )


__all__ = ["get_track_candidates_for_album_ids"]
