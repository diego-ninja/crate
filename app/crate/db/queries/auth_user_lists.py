from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.auth_presence import get_users_presence
from crate.db.queries.auth_user_activity import derive_user_activity
from crate.db.tx import read_scope


def list_users() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT
                    u.id,
                    u.email,
                    u.username,
                    u.name,
                    u.avatar,
                    u.role,
                    u.status,
                    u.status_reason,
                    u.suspended_at,
                    u.deleted_at,
                    u.google_id,
                    u.bio,
                    CASE WHEN u.password_hash IS NOT NULL AND u.password_hash <> '' THEN TRUE ELSE FALSE END AS has_password,
                    u.created_at,
                    u.last_login,
                    COALESCE((
                        SELECT COUNT(*)
                        FROM sessions s
                        WHERE s.user_id = u.id
                          AND s.revoked_at IS NULL
                          AND s.expires_at > NOW()
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
                          AND s.expires_at > NOW()
                    ), u.last_login) AS last_seen_at
                FROM users u
                ORDER BY u.id
                """
                )
            )
            .mappings()
            .all()
        )
    users = [dict(row) for row in rows]
    presence = get_users_presence(
        [int(user["id"]) for user in users if user.get("id") is not None]
    )
    for user in users:
        if user.get("id") is not None:
            user_presence = presence.get(int(user["id"]), {})
            user.update(user_presence)
            user.update(
                derive_user_activity(
                    last_login=user.get("last_login"),
                    last_seen_at=user_presence.get("last_seen_at"),
                    last_played_at=user_presence.get("last_played_at"),
                )
            )
    return users


def list_users_map_rows() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT u.id, u.name, u.email, u.username, u.avatar,
                       u.city, u.country, u.country_code,
                       u.latitude, u.longitude, u.role, u.status,
                       u.created_at, u.last_login
                FROM users u
                WHERE u.latitude IS NOT NULL AND u.longitude IS NOT NULL
                  AND COALESCE(u.status, 'active') = 'active'
                ORDER BY u.id
                """
                )
            )
            .mappings()
            .all()
        )

    user_ids = [int(row["id"]) for row in rows if row.get("id") is not None]
    presence = get_users_presence(user_ids)
    result: list[dict] = []
    for row in rows:
        user_id = int(row["id"])
        user_presence = presence.get(user_id, {})
        current_track = user_presence.get("current_track")
        result.append(
            {
                "id": user_id,
                "name": row["name"] or row["email"].split("@")[0],
                "email": row["email"],
                "username": row["username"],
                "avatar": row["avatar"],
                "city": row["city"],
                "country": row["country"],
                "country_code": row["country_code"],
                "latitude": float(row["latitude"]),
                "longitude": float(row["longitude"]),
                "role": row["role"],
                "status": row["status"] or "active",
                "created_at": row["created_at"],
                "last_login": row["last_login"],
                "last_seen_at": user_presence.get("last_seen_at"),
                "online": bool(user_presence.get("online_now")),
                "active_sessions": int(user_presence.get("active_sessions") or 0),
                "active_devices": int(user_presence.get("active_devices") or 0),
                "listening_now": bool(user_presence.get("listening_now")),
                "last_played_at": user_presence.get("last_played_at"),
                "current_track": current_track,
                "now_playing": {
                    "title": current_track.get("title"),
                    "artist": current_track.get("artist"),
                    "album": current_track.get("album"),
                }
                if current_track
                else None,
                **derive_user_activity(
                    last_login=row["last_login"],
                    last_seen_at=user_presence.get("last_seen_at"),
                    last_played_at=user_presence.get("last_played_at"),
                ),
            }
        )
    return result


__all__ = [
    "list_users",
    "list_users_map_rows",
]
