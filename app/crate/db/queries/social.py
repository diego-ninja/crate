from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from crate.db.tx import read_scope


def _cache_key(user_a_id: int, user_b_id: int) -> tuple[int, int]:
    return (user_a_id, user_b_id) if user_a_id < user_b_id else (user_b_id, user_a_id)


def _user_profile_sql(where_clause: str) -> str:
    return f"""
        SELECT
            u.id,
            u.username,
            u.name AS display_name,
            u.avatar,
            u.bio,
            u.created_at AS joined_at,
            (
                SELECT COUNT(*)
                FROM user_relationships ur
                WHERE ur.followed_user_id = u.id
            )::INTEGER AS followers_count,
            (
                SELECT COUNT(*)
                FROM user_relationships ur
                WHERE ur.follower_user_id = u.id
            )::INTEGER AS following_count,
            (
                SELECT COUNT(*)
                FROM user_relationships a
                JOIN user_relationships b
                  ON a.follower_user_id = b.followed_user_id
                 AND a.followed_user_id = b.follower_user_id
                WHERE a.follower_user_id = u.id
            )::INTEGER AS friends_count
        FROM users u
        WHERE {where_clause}
        LIMIT 1
    """


def get_relationship_state(viewer_user_id: int, target_user_id: int) -> dict:
    if viewer_user_id == target_user_id:
        return {
            "following": False,
            "followed_by": False,
            "is_friend": False,
        }
    with read_scope() as session:
        row = dict(
            session.execute(
                text(
                    """
                    SELECT
                        EXISTS(
                            SELECT 1 FROM user_relationships
                            WHERE follower_user_id = :viewer AND followed_user_id = :target
                        ) AS following,
                        EXISTS(
                            SELECT 1 FROM user_relationships
                            WHERE follower_user_id = :target AND followed_user_id = :viewer
                        ) AS followed_by
                    """
                ),
                {"viewer": viewer_user_id, "target": target_user_id},
            ).mappings().first()
            or {}
        )
    row["is_friend"] = bool(row.get("following") and row.get("followed_by"))
    return row


def get_followers(user_id: int, *, limit: int = 100) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    u.id,
                    u.username,
                    u.name AS display_name,
                    u.avatar,
                    ur.created_at AS followed_at
                FROM user_relationships ur
                JOIN users u ON u.id = ur.follower_user_id
                WHERE ur.followed_user_id = :user_id
                ORDER BY ur.created_at DESC
                LIMIT :lim
                """
            ),
            {"user_id": user_id, "lim": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_following(user_id: int, *, limit: int = 100) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    u.id,
                    u.username,
                    u.name AS display_name,
                    u.avatar,
                    ur.created_at AS followed_at
                FROM user_relationships ur
                JOIN users u ON u.id = ur.followed_user_id
                WHERE ur.follower_user_id = :user_id
                ORDER BY ur.created_at DESC
                LIMIT :lim
                """
            ),
            {"user_id": user_id, "lim": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def search_users(query: str, *, limit: int = 20) -> list[dict]:
    if not query.strip():
        return []
    pattern = f"%{query.strip()}%"
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    id,
                    username,
                    name AS display_name,
                    avatar,
                    bio,
                    created_at AS joined_at
                FROM users
                WHERE COALESCE(username, '') ILIKE :pattern
                   OR COALESCE(name, '') ILIKE :pattern
                ORDER BY
                    CASE WHEN COALESCE(username, '') ILIKE :pattern THEN 0 ELSE 1 END,
                    created_at DESC
                LIMIT :lim
                """
            ),
            {"pattern": pattern, "lim": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_public_user_profile(user_id: int) -> dict | None:
    with read_scope() as session:
        row = session.execute(
            text(_user_profile_sql("u.id = :user_id")),
            {"user_id": user_id},
        ).mappings().first()
    return dict(row) if row else None


def get_public_user_profile_by_username(username: str) -> dict | None:
    with read_scope() as session:
        row = session.execute(
            text(_user_profile_sql("u.username = :username")),
            {"username": username},
        ).mappings().first()
    return dict(row) if row else None


def get_public_playlists_for_user(user_id: int) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT DISTINCT
                    p.id,
                    p.name,
                    p.description,
                    p.cover_data_url,
                    p.cover_path,
                    p.visibility,
                    p.is_collaborative,
                    p.track_count,
                    p.total_duration,
                    p.updated_at
                FROM playlists p
                JOIN playlist_members pm ON pm.playlist_id = p.id
                WHERE pm.user_id = :user_id
                  AND p.scope = 'user'
                  AND p.visibility = 'public'
                ORDER BY p.updated_at DESC
                """
            ),
            {"user_id": user_id},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_cached_affinity(user_a_id: int, user_b_id: int, *, max_age_hours: int = 12) -> dict | None:
    pair_a, pair_b = _cache_key(user_a_id, user_b_id)
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
