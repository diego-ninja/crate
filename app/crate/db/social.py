from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from crate.db.serialize import serialize_row, serialize_rows
from crate.db.tx import transaction_scope


def follow_user(follower_user_id: int, followed_user_id: int, *, session=None) -> bool:
    if follower_user_id == followed_user_id:
        return False
    if session is None:
        with transaction_scope() as s:
            return follow_user(follower_user_id, followed_user_id, session=s)
    now = datetime.now(timezone.utc).isoformat()
    result = session.execute(
        text("""
        INSERT INTO user_relationships (follower_user_id, followed_user_id, created_at)
        VALUES (:follower, :followed, :now)
        ON CONFLICT (follower_user_id, followed_user_id) DO NOTHING
        """),
        {"follower": follower_user_id, "followed": followed_user_id, "now": now},
    )
    return result.rowcount > 0


def unfollow_user(follower_user_id: int, followed_user_id: int, *, session=None) -> bool:
    if session is None:
        with transaction_scope() as s:
            return unfollow_user(follower_user_id, followed_user_id, session=s)
    result = session.execute(
        text("""
        DELETE FROM user_relationships
        WHERE follower_user_id = :follower AND followed_user_id = :followed
        """),
        {"follower": follower_user_id, "followed": followed_user_id},
    )
    return result.rowcount > 0


def get_relationship_state(viewer_user_id: int, target_user_id: int) -> dict:
    if viewer_user_id == target_user_id:
        return {
            "following": False,
            "followed_by": False,
            "is_friend": False,
        }
    with transaction_scope() as session:
        row = dict(session.execute(
            text("""
            SELECT
                EXISTS(
                    SELECT 1 FROM user_relationships
                    WHERE follower_user_id = :viewer AND followed_user_id = :target
                ) AS following,
                EXISTS(
                    SELECT 1 FROM user_relationships
                    WHERE follower_user_id = :target AND followed_user_id = :viewer
                ) AS followed_by
            """),
            {"viewer": viewer_user_id, "target": target_user_id},
        ).mappings().first() or {})
    row["is_friend"] = bool(row.get("following") and row.get("followed_by"))
    return row


def get_followers(user_id: int, *, limit: int = 100) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
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
            """),
            {"user_id": user_id, "lim": limit},
        ).mappings().all()
        return serialize_rows(rows)


def get_following(user_id: int, *, limit: int = 100) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
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
            """),
            {"user_id": user_id, "lim": limit},
        ).mappings().all()
        return serialize_rows(rows)


def search_users(query: str, *, limit: int = 20) -> list[dict]:
    if not query.strip():
        return []
    pattern = f"%{query.strip()}%"
    with transaction_scope() as session:
        rows = session.execute(
            text("""
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
            """),
            {"pattern": pattern, "lim": limit},
        ).mappings().all()
        return serialize_rows(rows)


def get_public_user_profile(user_id: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text("""
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
            WHERE u.id = :user_id
            LIMIT 1
            """),
            {"user_id": user_id},
        ).mappings().first()
    return serialize_row(row) if row else None


def get_public_user_profile_by_username(username: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT id FROM users WHERE username = :username LIMIT 1"),
            {"username": username},
        ).mappings().first()
    if not row:
        return None
    return get_public_user_profile(row["id"])


def get_public_playlists_for_user(user_id: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
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
            """),
            {"user_id": user_id},
        ).mappings().all()
        return serialize_rows(rows)


def get_me_social(user_id: int) -> dict:
    profile = get_public_user_profile(user_id) or {
        "followers_count": 0,
        "following_count": 0,
        "friends_count": 0,
    }
    return {
        "followers_count": profile["followers_count"],
        "following_count": profile["following_count"],
        "friends_count": profile["friends_count"],
    }


def _cache_key(user_a_id: int, user_b_id: int) -> tuple[int, int]:
    return (user_a_id, user_b_id) if user_a_id < user_b_id else (user_b_id, user_a_id)


def _get_cached_affinity(user_a_id: int, user_b_id: int, *, max_age_hours: int = 12) -> dict | None:
    pair_a, pair_b = _cache_key(user_a_id, user_b_id)
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=max_age_hours)).isoformat()
    with transaction_scope() as session:
        row = session.execute(
            text("""
            SELECT affinity_score, affinity_band, reasons_json, computed_at
            FROM user_affinity_cache
            WHERE user_a_id = :pair_a AND user_b_id = :pair_b AND computed_at >= :cutoff
            """),
            {"pair_a": pair_a, "pair_b": pair_b, "cutoff": cutoff},
        ).mappings().first()
    if not row:
        return None
    item = dict(row)
    item["affinity_reasons"] = item.pop("reasons_json") or []
    return item


def _store_affinity(user_a_id: int, user_b_id: int, *, score: int, band: str, reasons: list[str], session=None) -> None:
    if session is None:
        with transaction_scope() as s:
            return _store_affinity(user_a_id, user_b_id, score=score, band=band, reasons=reasons, session=s)
    pair_a, pair_b = _cache_key(user_a_id, user_b_id)
    now = datetime.now(timezone.utc).isoformat()
    session.execute(
            text("""
            INSERT INTO user_affinity_cache (user_a_id, user_b_id, affinity_score, affinity_band, reasons_json, computed_at)
            VALUES (:pair_a, :pair_b, :score, :band, :reasons, :now)
            ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET
                affinity_score = EXCLUDED.affinity_score,
                affinity_band = EXCLUDED.affinity_band,
                reasons_json = EXCLUDED.reasons_json,
                computed_at = EXCLUDED.computed_at
            """),
            {"pair_a": pair_a, "pair_b": pair_b, "score": score,
             "band": band, "reasons": json.dumps(reasons), "now": now},
        )


def get_affinity(user_a_id: int, user_b_id: int) -> dict:
    if user_a_id == user_b_id:
        return {
            "affinity_score": 100,
            "affinity_band": "very_high",
            "affinity_reasons": ["Same user"],
        }

    cached = _get_cached_affinity(user_a_id, user_b_id)
    if cached:
        return cached

    reasons: list[str] = []
    score = 0
    with transaction_scope() as session:
        row = session.execute(
            text("""
            SELECT COUNT(*)::INTEGER AS cnt
            FROM user_follows a
            JOIN user_follows b ON a.artist_name = b.artist_name
            WHERE a.user_id = :a AND b.user_id = :b
            """),
            {"a": user_a_id, "b": user_b_id},
        ).mappings().first()
        shared_followed_artists = int((row or {}).get("cnt") or 0)
        score += min(shared_followed_artists * 4, 20)
        if shared_followed_artists:
            reasons.append(f"{shared_followed_artists} shared followed artists")

        row = session.execute(
            text("""
            SELECT COUNT(*)::INTEGER AS cnt
            FROM user_liked_tracks a
            JOIN user_liked_tracks b ON a.track_id = b.track_id
            WHERE a.user_id = :a AND b.user_id = :b
            """),
            {"a": user_a_id, "b": user_b_id},
        ).mappings().first()
        shared_likes = int((row or {}).get("cnt") or 0)
        score += min(shared_likes * 3, 15)
        if shared_likes:
            reasons.append(f"{shared_likes} shared liked tracks")

        row = session.execute(
            text("""
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
            """),
            {"a": user_a_id, "b": user_b_id},
        ).mappings().first()
        shared_top_artists = int((row or {}).get("cnt") or 0)
        score += min(shared_top_artists * 4, 20)
        if shared_top_artists:
            reasons.append(f"{shared_top_artists} similar recent top artists")

        row = session.execute(
            text("""
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
            """),
            {"a": user_a_id, "b": user_b_id},
        ).mappings().first()
        shared_top_albums = int((row or {}).get("cnt") or 0)
        score += min(shared_top_albums * 4, 15)
        if shared_top_albums:
            reasons.append(f"{shared_top_albums} overlapping top albums")

        row = session.execute(
            text("""
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
            """),
            {"a": user_a_id, "b": user_b_id},
        ).mappings().first()
        shared_top_tracks = int((row or {}).get("cnt") or 0)
        score += min(shared_top_tracks * 5, 15)
        if shared_top_tracks:
            reasons.append(f"{shared_top_tracks} overlapping top tracks")

        row = session.execute(
            text("""
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
            """),
            {"a": user_a_id, "b": user_b_id},
        ).mappings().first()
        shared_recent_artists = int((row or {}).get("cnt") or 0)
        score += min(shared_recent_artists * 3, 10)

        row = session.execute(
            text("""
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
            """),
            {"a": user_a_id, "b": user_b_id},
        ).mappings().first()
        shared_discovery = int((row or {}).get("cnt") or 0)
        score += min(shared_discovery * 5, 5)
        if shared_discovery:
            reasons.append(f"{shared_discovery} shared recent discoveries")

    score = max(0, min(100, score))
    if score >= 80:
        band = "very_high"
    elif score >= 55:
        band = "high"
    elif score >= 30:
        band = "medium"
    else:
        band = "low"

    if not reasons:
        reasons = ["Limited overlap so far"]

    _store_affinity(user_a_id, user_b_id, score=score, band=band, reasons=reasons[:4])
    return {
        "affinity_score": score,
        "affinity_band": band,
        "affinity_reasons": reasons[:4],
    }
