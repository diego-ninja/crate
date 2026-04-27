from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from crate.db.tx import read_scope


def get_users_presence(user_ids: list[int]) -> dict[int, dict]:
    if not user_ids:
        return {}

    from crate.db.cache_store import get_cache

    with read_scope() as session:
        session_rows = session.execute(
            text(
                """
                SELECT
                    s.user_id,
                    COUNT(*) FILTER (
                        WHERE s.revoked_at IS NULL
                          AND (s.expires_at IS NULL OR s.expires_at > NOW())
                          AND COALESCE(s.last_seen_at, s.created_at) >= NOW() - INTERVAL '10 minutes'
                    )::INTEGER AS active_sessions,
                    COUNT(DISTINCT COALESCE(
                        NULLIF(s.app_id, ''),
                        NULLIF(s.device_label, ''),
                        NULLIF(split_part(COALESCE(s.user_agent, ''), '/', 1), ''),
                        NULLIF(s.last_seen_ip, ''),
                        s.id
                    )) FILTER (
                        WHERE s.revoked_at IS NULL
                          AND (s.expires_at IS NULL OR s.expires_at > NOW())
                          AND COALESCE(s.last_seen_at, s.created_at) >= NOW() - INTERVAL '10 minutes'
                    )::INTEGER AS active_devices,
                    MAX(COALESCE(s.last_seen_at, s.created_at)) FILTER (
                        WHERE s.revoked_at IS NULL
                          AND (s.expires_at IS NULL OR s.expires_at > NOW())
                    ) AS last_seen_at
                FROM sessions s
                WHERE s.user_id = ANY(:user_ids)
                GROUP BY s.user_id
                """
            ),
            {"user_ids": user_ids},
        ).mappings().all()

        play_rows = session.execute(
            text(
                """
                SELECT DISTINCT ON (upe.user_id)
                    upe.user_id,
                    COALESCE(lt.id, upe.track_id) AS track_id,
                    lt.storage_id AS track_storage_id,
                    COALESCE(lt.title, upe.title) AS title,
                    COALESCE(lt.artist, upe.artist) AS artist,
                    ar.id AS artist_id,
                    ar.slug AS artist_slug,
                    COALESCE(lt.album, upe.album) AS album,
                    alb.id AS album_id,
                    alb.slug AS album_slug,
                    upe.ended_at AS played_at
                FROM user_play_events upe
                LEFT JOIN library_tracks lt
                  ON lt.id = upe.track_id
                  OR (upe.track_id IS NULL AND lt.path = upe.track_path)
                LEFT JOIN library_albums alb ON alb.id = lt.album_id
                LEFT JOIN library_artists ar ON ar.name = COALESCE(lt.artist, upe.artist)
                WHERE upe.user_id = ANY(:user_ids)
                ORDER BY upe.user_id, upe.ended_at DESC
                """
            ),
            {"user_ids": user_ids},
        ).mappings().all()

    now_playing_rows: dict[int, dict] = {}
    for user_id in user_ids:
        cached = get_cache(f"now_playing:{user_id}", max_age_seconds=90)
        if isinstance(cached, dict):
            now_playing_rows[user_id] = cached

    now = datetime.now(timezone.utc)
    listening_cutoff = now - timedelta(minutes=5)
    presence: dict[int, dict] = {
        user_id: {
            "online_now": False,
            "active_devices": 0,
            "active_sessions": 0,
            "listening_now": False,
            "current_track": None,
            "last_played_at": None,
            "last_seen_at": None,
        }
        for user_id in user_ids
    }

    for row in session_rows:
        user_id = int(row["user_id"])
        active_sessions = int(row.get("active_sessions") or 0)
        active_devices = int(row.get("active_devices") or 0)
        last_seen_at = row.get("last_seen_at")
        presence[user_id].update(
            {
                "online_now": active_sessions > 0,
                "active_sessions": active_sessions,
                "active_devices": active_devices,
                "last_seen_at": last_seen_at,
            }
        )

    for user_id, row in now_playing_rows.items():
        started_at = row.get("started_at") or row.get("heartbeat_at")
        current_track = (
            {
                "track_id": row.get("track_id"),
                "track_storage_id": row.get("track_storage_id"),
                "title": row.get("title"),
                "artist": row.get("artist"),
                "artist_id": None,
                "artist_slug": None,
                "album": row.get("album"),
                "album_id": None,
                "album_slug": None,
                "played_at": started_at,
            }
            if row.get("title") or row.get("artist") or row.get("album")
            else None
        )
        presence[user_id].update(
            {
                "online_now": True if current_track else presence[user_id]["online_now"],
                "listening_now": current_track is not None,
                "current_track": current_track,
                "last_played_at": started_at,
            }
        )

    for row in play_rows:
        user_id = int(row["user_id"])
        if presence[user_id].get("listening_now"):
            continue
        played_at = row.get("played_at")
        current_track = (
            {
                "track_id": row.get("track_id"),
                "track_storage_id": str(row.get("track_storage_id")) if row.get("track_storage_id") is not None else None,
                "title": row.get("title"),
                "artist": row.get("artist"),
                "artist_id": row.get("artist_id"),
                "artist_slug": row.get("artist_slug"),
                "album": row.get("album"),
                "album_id": row.get("album_id"),
                "album_slug": row.get("album_slug"),
                "played_at": played_at,
            }
            if played_at
            else None
        )
        presence[user_id].update(
            {
                "last_played_at": played_at,
                "listening_now": bool(played_at and played_at >= listening_cutoff),
                "current_track": current_track,
            }
        )

    return presence


__all__ = ["get_users_presence"]
