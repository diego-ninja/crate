from __future__ import annotations

from crate.db.queries.home_track_rows import _fetch_rows


def get_discovery_track_rows(*, user_id: int, genres: list[str], excluded_artist_names: list[str], limit: int = 240) -> list[dict]:
    if not genres:
        return []
    capped_genres = genres[:20]
    capped_excluded = excluded_artist_names[:50]
    return _fetch_rows(
        """
        WITH matching_artists AS MATERIALIZED (
            SELECT DISTINCT ag.artist_name
            FROM artist_genres ag
            JOIN genres g ON g.id = ag.genre_id
            WHERE LOWER(g.name) = ANY(:genres)
              AND NOT (LOWER(ag.artist_name) = ANY(:excluded))
            LIMIT 200
        )
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
        FROM matching_artists ma
        JOIN library_tracks t ON t.artist = ma.artist_name
        JOIN library_albums alb ON alb.id = t.album_id
        LEFT JOIN library_artists art ON art.name = t.artist
        LEFT JOIN user_track_stats uts
          ON uts.user_id = :user_id
         AND uts.stat_window = '90d'
         AND uts.track_id = t.id
        LEFT JOIN user_liked_tracks ult
          ON ult.user_id = :user_id
         AND ult.track_id = t.id
        ORDER BY
            COALESCE(t.lastfm_playcount, 0) DESC,
            t.title ASC
        LIMIT :lim
        """,
        {"user_id": user_id, "genres": capped_genres, "excluded": capped_excluded, "lim": limit},
    )


__all__ = ["get_discovery_track_rows"]
