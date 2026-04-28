from __future__ import annotations


def cache_key(user_a_id: int, user_b_id: int) -> tuple[int, int]:
    return (user_a_id, user_b_id) if user_a_id < user_b_id else (user_b_id, user_a_id)


def user_profile_sql(where_clause: str) -> str:
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


__all__ = ["cache_key", "user_profile_sql"]
