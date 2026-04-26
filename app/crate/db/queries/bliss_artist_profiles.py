from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from crate.db.tx import transaction_scope


def build_user_radio_profile(
    user_id: int | None,
    track_ids: list[int],
    artist_names: list[str],
    artist_name_keys: list[str],
    album_pairs: list[tuple[str, str]],
) -> dict:
    if not user_id:
        return {}

    recency_cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()

    with transaction_scope() as session:
        liked_track_ids: set[int] = set()
        if track_ids:
            result = session.execute(
                text(
                    """
                    SELECT track_id
                    FROM user_liked_tracks
                    WHERE user_id = :user_id AND track_id = ANY(:track_ids)
                    """
                ),
                {"user_id": user_id, "track_ids": track_ids},
            ).mappings().all()
            liked_track_ids = {row["track_id"] for row in result}

        recent_track_events: dict[int, dict] = {}
        if track_ids:
            result = session.execute(
                text(
                    """
                    SELECT
                        track_id,
                        COUNT(*)::INTEGER AS play_count,
                        SUM(CASE WHEN was_skipped THEN 1 ELSE 0 END)::INTEGER AS skip_count,
                        MAX(ended_at) AS last_played_at
                    FROM user_play_events
                    WHERE user_id = :user_id
                      AND track_id = ANY(:track_ids)
                      AND ended_at >= :recency_cutoff
                    GROUP BY track_id
                    """
                ),
                {"user_id": user_id, "track_ids": track_ids, "recency_cutoff": recency_cutoff},
            ).mappings().all()
            recent_track_events = {row["track_id"]: dict(row) for row in result}

        artist_stats: dict[str, dict] = {}
        if artist_names:
            result = session.execute(
                text(
                    """
                    SELECT
                        artist_name,
                        play_count,
                        complete_play_count,
                        last_played_at
                    FROM user_artist_stats
                    WHERE user_id = :user_id
                      AND stat_window = '30d'
                      AND LOWER(artist_name) = ANY(:artist_name_keys)
                    """
                ),
                {"user_id": user_id, "artist_name_keys": artist_name_keys},
            ).mappings().all()
            artist_stats = {row["artist_name"].lower(): dict(row) for row in result}

        album_stats: dict[tuple[str, str], dict] = {}
        if album_pairs:
            artist_list = [artist.lower() for artist, _ in album_pairs]
            album_list = [album.lower() for _, album in album_pairs]
            result = session.execute(
                text(
                    """
                    WITH pairs(artist_key, album_key) AS (
                        SELECT *
                        FROM UNNEST(
                            CAST(:artist_list AS text[]),
                            CAST(:album_list AS text[])
                        )
                    )
                    SELECT
                        s.artist,
                        s.album,
                        s.play_count,
                        s.complete_play_count,
                        s.last_played_at
                    FROM user_album_stats s
                    JOIN pairs p
                      ON LOWER(s.artist) = p.artist_key
                     AND LOWER(s.album) = p.album_key
                    WHERE s.user_id = :user_id
                      AND s.stat_window = '30d'
                    """
                ),
                {"artist_list": artist_list, "album_list": album_list, "user_id": user_id},
            ).mappings().all()
            album_stats = {
                ((row["artist"] or "").lower(), (row["album"] or "").lower()): dict(row)
                for row in result
            }

    return {
        "liked_track_ids": liked_track_ids,
        "recent_track_events": recent_track_events,
        "artist_stats": artist_stats,
        "album_stats": album_stats,
    }


__all__ = ["build_user_radio_profile"]
