from __future__ import annotations

from sqlalchemy import text


def recompute_user_daily_listening(session, user_id: int):
    session.execute(text("DELETE FROM user_daily_listening WHERE user_id = :user_id"), {"user_id": user_id})
    session.execute(
        text(
            """
            INSERT INTO user_daily_listening (
                user_id,
                day,
                play_count,
                complete_play_count,
                skip_count,
                minutes_listened,
                unique_tracks,
                unique_artists,
                unique_albums
            )
            SELECT
                user_id,
                (ended_at AT TIME ZONE 'UTC')::date AS day,
                COUNT(*)::INTEGER AS play_count,
                SUM(CASE WHEN was_completed THEN 1 ELSE 0 END)::INTEGER AS complete_play_count,
                SUM(CASE WHEN was_skipped THEN 1 ELSE 0 END)::INTEGER AS skip_count,
                COALESCE(SUM(played_seconds), 0) / 60.0 AS minutes_listened,
                COUNT(DISTINCT COALESCE(track_id::text, NULLIF(track_path, ''), 'unknown-track'))::INTEGER AS unique_tracks,
                COUNT(DISTINCT NULLIF(artist, ''))::INTEGER AS unique_artists,
                COUNT(DISTINCT NULLIF(CONCAT(COALESCE(artist, ''), '||', COALESCE(album, '')), '||'))::INTEGER AS unique_albums
            FROM user_play_events
            WHERE user_id = :user_id
            GROUP BY user_id, (ended_at AT TIME ZONE 'UTC')::date
            """
        ),
        {"user_id": user_id},
    )


__all__ = ["recompute_user_daily_listening"]
