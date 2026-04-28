from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.social_shared import user_profile_sql
from crate.db.tx import read_scope


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
            text(user_profile_sql("u.id = :user_id")),
            {"user_id": user_id},
        ).mappings().first()
    return dict(row) if row else None


def get_public_user_profile_by_username(username: str) -> dict | None:
    with read_scope() as session:
        row = session.execute(
            text(user_profile_sql("u.username = :username")),
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


__all__ = [
    "get_followers",
    "get_following",
    "get_public_playlists_for_user",
    "get_public_user_profile",
    "get_public_user_profile_by_username",
    "search_users",
]
