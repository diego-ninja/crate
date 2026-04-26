from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from crate.db.queries.social_shared import cache_key
from crate.db.tx import read_scope


def get_cached_affinity(user_a_id: int, user_b_id: int, *, max_age_hours: int = 12) -> dict | None:
    pair_a, pair_b = cache_key(user_a_id, user_b_id)
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=max_age_hours)).isoformat()
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT affinity_score, affinity_band, reasons_json, computed_at
                FROM user_affinity_cache
                WHERE user_a_id = :pair_a AND user_b_id = :pair_b AND computed_at >= :cutoff
                """
            ),
            {"pair_a": pair_a, "pair_b": pair_b, "cutoff": cutoff},
        ).mappings().first()
    if not row:
        return None
    item = dict(row)
    item["affinity_reasons"] = item.pop("reasons_json") or []
    return item


def get_affinity_overlap_counts(user_a_id: int, user_b_id: int) -> dict[str, int]:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT COUNT(*)::INTEGER AS cnt
                FROM user_follows a
                JOIN user_follows b ON a.artist_name = b.artist_name
                WHERE a.user_id = :a AND b.user_id = :b
                """
            ),
            {"a": user_a_id, "b": user_b_id},
        ).mappings().first()
        shared_followed_artists = int((row or {}).get("cnt") or 0)

        row = session.execute(
            text(
                """
                SELECT COUNT(*)::INTEGER AS cnt
                FROM user_liked_tracks a
                JOIN user_liked_tracks b ON a.track_id = b.track_id
                WHERE a.user_id = :a AND b.user_id = :b
                """
            ),
            {"a": user_a_id, "b": user_b_id},
        ).mappings().first()
        shared_likes = int((row or {}).get("cnt") or 0)

        row = session.execute(
            text(
                """
                SELECT COUNT(*)::INTEGER AS cnt
                FROM (
                    SELECT artist_name
                    FROM user_artist_stats
                    WHERE user_id = :a AND stat_window = '90d'
                    ORDER BY play_count DESC, minutes_listened DESC
                    LIMIT 25
                ) a
                JOIN (
                    SELECT artist_name
                    FROM user_artist_stats
                    WHERE user_id = :b AND stat_window = '90d'
                    ORDER BY play_count DESC, minutes_listened DESC
                    LIMIT 25
                ) b USING (artist_name)
                """
            ),
            {"a": user_a_id, "b": user_b_id},
        ).mappings().first()
        shared_top_artists = int((row or {}).get("cnt") or 0)

        row = session.execute(
            text(
                """
                SELECT COUNT(*)::INTEGER AS cnt
                FROM (
                    SELECT entity_key
                    FROM user_album_stats
                    WHERE user_id = :a AND stat_window = '90d'
                    ORDER BY play_count DESC, minutes_listened DESC
                    LIMIT 20
                ) a
                JOIN (
                    SELECT entity_key
                    FROM user_album_stats
                    WHERE user_id = :b AND stat_window = '90d'
                    ORDER BY play_count DESC, minutes_listened DESC
                    LIMIT 20
                ) b USING (entity_key)
                """
            ),
            {"a": user_a_id, "b": user_b_id},
        ).mappings().first()
        shared_top_albums = int((row or {}).get("cnt") or 0)

        row = session.execute(
            text(
                """
                SELECT COUNT(*)::INTEGER AS cnt
                FROM (
                    SELECT entity_key
                    FROM user_track_stats
                    WHERE user_id = :a AND stat_window = '90d'
                    ORDER BY play_count DESC, minutes_listened DESC
                    LIMIT 20
                ) a
                JOIN (
                    SELECT entity_key
                    FROM user_track_stats
                    WHERE user_id = :b AND stat_window = '90d'
                    ORDER BY play_count DESC, minutes_listened DESC
                    LIMIT 20
                ) b USING (entity_key)
                """
            ),
            {"a": user_a_id, "b": user_b_id},
        ).mappings().first()
        shared_top_tracks = int((row or {}).get("cnt") or 0)

        row = session.execute(
            text(
                """
                SELECT COUNT(*)::INTEGER AS cnt
                FROM (
                    SELECT artist_name
                    FROM user_artist_stats
                    WHERE user_id = :a AND stat_window = '30d'
                    ORDER BY play_count DESC, minutes_listened DESC
                    LIMIT 15
                ) a
                JOIN (
                    SELECT artist_name
                    FROM user_artist_stats
                    WHERE user_id = :b AND stat_window = '30d'
                    ORDER BY play_count DESC, minutes_listened DESC
                    LIMIT 15
                ) b USING (artist_name)
                """
            ),
            {"a": user_a_id, "b": user_b_id},
        ).mappings().first()
        shared_recent_artists = int((row or {}).get("cnt") or 0)

        row = session.execute(
            text(
                """
                SELECT COUNT(*)::INTEGER AS cnt
                FROM (
                    SELECT artist_name
                    FROM user_artist_stats
                    WHERE user_id = :a
                      AND stat_window = '90d'
                      AND first_played_at >= NOW() - INTERVAL '60 days'
                    ORDER BY first_played_at DESC
                    LIMIT 15
                ) a
                JOIN (
                    SELECT artist_name
                    FROM user_artist_stats
                    WHERE user_id = :b
                      AND stat_window = '90d'
                      AND first_played_at >= NOW() - INTERVAL '60 days'
                    ORDER BY first_played_at DESC
                    LIMIT 15
                ) b USING (artist_name)
                """
            ),
            {"a": user_a_id, "b": user_b_id},
        ).mappings().first()
        shared_discovery = int((row or {}).get("cnt") or 0)

    return {
        "shared_followed_artists": shared_followed_artists,
        "shared_likes": shared_likes,
        "shared_top_artists": shared_top_artists,
        "shared_top_albums": shared_top_albums,
        "shared_top_tracks": shared_top_tracks,
        "shared_recent_artists": shared_recent_artists,
        "shared_discovery": shared_discovery,
    }


__all__ = ["get_affinity_overlap_counts", "get_cached_affinity"]
