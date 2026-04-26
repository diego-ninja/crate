from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.auth_presence import get_users_presence
from crate.db.tx import read_scope


def list_users() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    u.id,
                    u.email,
                    u.username,
                    u.name,
                    u.avatar,
                    u.role,
                    u.google_id,
                    u.bio,
                    u.created_at,
                    u.last_login,
                    COALESCE((
                        SELECT COUNT(*)
                        FROM sessions s
                        WHERE s.user_id = u.id
                          AND s.revoked_at IS NULL
                          AND COALESCE(s.last_seen_at, s.created_at) >= NOW() - INTERVAL '10 minutes'
                    ), 0)::INTEGER AS active_sessions,
                    COALESCE((
                        SELECT json_agg(
                            json_build_object(
                                'provider', provider,
                                'status', status,
                                'external_username', external_username
                            )
                            ORDER BY provider
                        )
                        FROM user_external_identities
                        WHERE user_id = u.id
                    ), '[]'::json) AS connected_accounts,
                    COALESCE((
                        SELECT MAX(COALESCE(last_seen_at, created_at))
                        FROM sessions s
                        WHERE s.user_id = u.id
                          AND s.revoked_at IS NULL
                    ), u.last_login) AS last_seen_at
                FROM users u
                ORDER BY u.id
                """
            )
        ).mappings().all()
    users = [dict(row) for row in rows]
    presence = get_users_presence([int(user["id"]) for user in users if user.get("id") is not None])
    for user in users:
        if user.get("id") is not None:
            user.update(presence.get(int(user["id"]), {}))
    return users


def list_users_map_rows() -> list[dict]:
    from crate.db.cache_store import get_cache

    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT u.id, u.name, u.email, u.avatar, u.city, u.country, u.latitude, u.longitude,
                       u.created_at,
                       MAX(s.last_seen_at) AS last_seen_at,
                       CASE WHEN MAX(s.last_seen_at) > NOW() - interval '5 minutes' THEN TRUE ELSE FALSE END AS online
                FROM users u
                LEFT JOIN sessions s ON s.user_id = u.id
                WHERE u.latitude IS NOT NULL AND u.longitude IS NOT NULL
                GROUP BY u.id
                """
            )
        ).mappings().all()

    result: list[dict] = []
    for row in rows:
        now_playing = get_cache(f"now_playing:{row['id']}", max_age_seconds=120)
        result.append(
            {
                "id": row["id"],
                "name": row["name"] or row["email"].split("@")[0],
                "email": row["email"],
                "avatar": row["avatar"],
                "city": row["city"],
                "country": row["country"],
                "latitude": float(row["latitude"]),
                "longitude": float(row["longitude"]),
                "online": bool(row["online"]),
                "now_playing": {
                    "title": now_playing.get("title"),
                    "artist": now_playing.get("artist"),
                    "album": now_playing.get("album"),
                }
                if now_playing
                else None,
            }
        )
    return result


__all__ = [
    "list_users",
    "list_users_map_rows",
]
