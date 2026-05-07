from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from crate.db.repositories.auth_shared import coerce_datetime, enrich_auth_session, promote_now_playing_session
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
                    s.id,
                    s.user_id,
                    s.created_at,
                    s.last_seen_at,
                    s.expires_at,
                    s.revoked_at,
                    s.last_seen_ip,
                    s.user_agent,
                    s.app_id,
                    s.device_label,
                    s.device_fingerprint
                FROM sessions s
                WHERE s.user_id = ANY(:user_ids)
                ORDER BY s.user_id, COALESCE(s.last_seen_at, s.created_at) DESC
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
                    lt.entity_uid AS track_entity_uid,
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
                  OR (upe.track_id IS NULL AND upe.track_entity_uid IS NOT NULL AND lt.entity_uid = upe.track_entity_uid)
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
    active_devices_by_user: dict[int, set[str]] = {user_id: set() for user_id in user_ids}

    sessions_by_user: dict[int, list[dict]] = {user_id: [] for user_id in user_ids}
    for row in session_rows:
        enriched = enrich_auth_session(dict(row), now=now)
        sessions_by_user[int(enriched["user_id"])].append(enriched)

    for user_id, sessions in sessions_by_user.items():
        now_playing = now_playing_rows.get(user_id)
        if now_playing:
            sessions = promote_now_playing_session(sessions, now_playing=now_playing, now=now)
            sessions_by_user[user_id] = sessions

    for user_id, sessions in sessions_by_user.items():
        for enriched in sessions:
            last_seen_at = coerce_datetime(enriched.get("last_seen_at")) or coerce_datetime(enriched.get("created_at"))

            if last_seen_at and (
                presence[user_id]["last_seen_at"] is None
                or last_seen_at > presence[user_id]["last_seen_at"]
            ):
                presence[user_id]["last_seen_at"] = last_seen_at

            if enriched.get("is_active"):
                presence[user_id]["active_sessions"] += 1
                presence[user_id]["online_now"] = True
                fingerprint = enriched.get("device_fingerprint") or str(enriched["id"])
                active_devices_by_user[user_id].add(fingerprint)

    for user_id in user_ids:
        presence[user_id]["active_devices"] = len(active_devices_by_user[user_id])

    for user_id, row in now_playing_rows.items():
        started_at = row.get("started_at") or row.get("heartbeat_at")
        current_track = (
            {
                "track_id": row.get("track_id"),
                "track_entity_uid": row.get("track_entity_uid"),
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
                "track_entity_uid": str(row.get("track_entity_uid")) if row.get("track_entity_uid") is not None else None,
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
