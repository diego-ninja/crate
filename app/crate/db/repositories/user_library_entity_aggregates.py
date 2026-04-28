from __future__ import annotations

from sqlalchemy import text

from crate.db.repositories.user_library_aggregate_shared import window_filter_sql


def recompute_user_track_stats(session, user_id: int, window: str, cutoff: str | None):
    session.execute(
        text("DELETE FROM user_track_stats WHERE user_id = :user_id AND stat_window = :window"),
        {"user_id": user_id, "window": window},
    )
    where_sql, extra_params = window_filter_sql(cutoff)
    params = {"user_id": user_id, "window": window, "filter_user_id": user_id, **extra_params}
    session.execute(
        text(
            f"""
            INSERT INTO user_track_stats (
                user_id,
                stat_window,
                entity_key,
                track_id,
                track_path,
                title,
                artist,
                album,
                play_count,
                complete_play_count,
                minutes_listened,
                first_played_at,
                last_played_at
            )
            SELECT
                :user_id,
                :window,
                COALESCE(upe.track_id::text, NULLIF(upe.track_path, ''), 'unknown-track') AS entity_key,
                MAX(upe.track_id) AS track_id,
                MAX(upe.track_path) AS track_path,
                MAX(upe.title) AS title,
                MAX(upe.artist) AS artist,
                MAX(upe.album) AS album,
                COUNT(*)::INTEGER AS play_count,
                SUM(CASE WHEN upe.was_completed THEN 1 ELSE 0 END)::INTEGER AS complete_play_count,
                COALESCE(SUM(upe.played_seconds), 0) / 60.0 AS minutes_listened,
                MIN(upe.started_at) AS first_played_at,
                MAX(upe.ended_at) AS last_played_at
            FROM user_play_events upe
            WHERE {where_sql}
              AND (upe.track_id IS NOT NULL OR COALESCE(upe.track_path, '') != '')
            GROUP BY COALESCE(upe.track_id::text, NULLIF(upe.track_path, ''), 'unknown-track')
            """
        ),
        params,
    )


def recompute_user_artist_stats(session, user_id: int, window: str, cutoff: str | None):
    session.execute(
        text("DELETE FROM user_artist_stats WHERE user_id = :user_id AND stat_window = :window"),
        {"user_id": user_id, "window": window},
    )
    where_sql, extra_params = window_filter_sql(cutoff)
    params = {"user_id": user_id, "window": window, "filter_user_id": user_id, **extra_params}
    session.execute(
        text(
            f"""
            INSERT INTO user_artist_stats (
                user_id,
                stat_window,
                artist_name,
                play_count,
                complete_play_count,
                minutes_listened,
                first_played_at,
                last_played_at
            )
            SELECT
                :user_id,
                :window,
                upe.artist AS artist_name,
                COUNT(*)::INTEGER AS play_count,
                SUM(CASE WHEN upe.was_completed THEN 1 ELSE 0 END)::INTEGER AS complete_play_count,
                COALESCE(SUM(upe.played_seconds), 0) / 60.0 AS minutes_listened,
                MIN(upe.started_at) AS first_played_at,
                MAX(upe.ended_at) AS last_played_at
            FROM user_play_events upe
            WHERE {where_sql}
              AND COALESCE(upe.artist, '') != ''
            GROUP BY upe.artist
            """
        ),
        params,
    )


def recompute_user_album_stats(session, user_id: int, window: str, cutoff: str | None):
    session.execute(
        text("DELETE FROM user_album_stats WHERE user_id = :user_id AND stat_window = :window"),
        {"user_id": user_id, "window": window},
    )
    where_sql, extra_params = window_filter_sql(cutoff)
    params = {"user_id": user_id, "window": window, "filter_user_id": user_id, **extra_params}
    session.execute(
        text(
            f"""
            INSERT INTO user_album_stats (
                user_id,
                stat_window,
                entity_key,
                artist,
                album,
                play_count,
                complete_play_count,
                minutes_listened,
                first_played_at,
                last_played_at
            )
            SELECT
                :user_id,
                :window,
                CONCAT(COALESCE(upe.artist, ''), '||', COALESCE(upe.album, '')) AS entity_key,
                MAX(upe.artist) AS artist,
                MAX(upe.album) AS album,
                COUNT(*)::INTEGER AS play_count,
                SUM(CASE WHEN upe.was_completed THEN 1 ELSE 0 END)::INTEGER AS complete_play_count,
                COALESCE(SUM(upe.played_seconds), 0) / 60.0 AS minutes_listened,
                MIN(upe.started_at) AS first_played_at,
                MAX(upe.ended_at) AS last_played_at
            FROM user_play_events upe
            WHERE {where_sql}
              AND COALESCE(upe.album, '') != ''
            GROUP BY CONCAT(COALESCE(upe.artist, ''), '||', COALESCE(upe.album, ''))
            """
        ),
        params,
    )


def recompute_user_genre_stats(session, user_id: int, window: str, cutoff: str | None):
    session.execute(
        text("DELETE FROM user_genre_stats WHERE user_id = :user_id AND stat_window = :window"),
        {"user_id": user_id, "window": window},
    )
    where_sql, extra_params = window_filter_sql(cutoff)
    params = {"user_id": user_id, "window": window, "filter_user_id": user_id, **extra_params}
    session.execute(
        text(
            f"""
            INSERT INTO user_genre_stats (
                user_id,
                stat_window,
                genre_name,
                play_count,
                complete_play_count,
                minutes_listened,
                first_played_at,
                last_played_at
            )
            SELECT
                :user_id,
                :window,
                lt.genre AS genre_name,
                COUNT(*)::INTEGER AS play_count,
                SUM(CASE WHEN upe.was_completed THEN 1 ELSE 0 END)::INTEGER AS complete_play_count,
                COALESCE(SUM(upe.played_seconds), 0) / 60.0 AS minutes_listened,
                MIN(upe.started_at) AS first_played_at,
                MAX(upe.ended_at) AS last_played_at
            FROM user_play_events upe
            LEFT JOIN library_tracks lt
              ON lt.id = upe.track_id
              OR (upe.track_id IS NULL AND COALESCE(upe.track_path, '') != '' AND lt.path = upe.track_path)
            WHERE {where_sql}
              AND COALESCE(lt.genre, '') != ''
            GROUP BY lt.genre
            """
        ),
        params,
    )


__all__ = [
    "recompute_user_album_stats",
    "recompute_user_artist_stats",
    "recompute_user_genre_stats",
    "recompute_user_track_stats",
]
