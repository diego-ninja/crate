from __future__ import annotations

from datetime import datetime
import logging

from sqlalchemy import text

from crate.db.cache_store import get_cache, set_cache
from crate.db.repositories.tasks import create_task_dedup
from crate.db.repositories.user_library_shared import emit_user_domain_event, resolve_track_reference, utc_now_iso
from crate.db.tx import register_after_commit, transaction_scope

_STATS_REFRESH_DEBOUNCE_SECONDS = 300
log = logging.getLogger(__name__)


def _schedule_stats_refresh(user_id: int) -> None:
    debounce_key = f"stats_refresh_debounce:{user_id}"
    if get_cache(debounce_key, max_age_seconds=_STATS_REFRESH_DEBOUNCE_SECONDS):
        return
    create_task_dedup("refresh_user_listening_stats", {"user_id": user_id})
    set_cache(debounce_key, True, ttl=_STATS_REFRESH_DEBOUNCE_SECONDS)


def _queue_scrobble(
    user_id: int,
    *,
    artist: str,
    title: str,
    album: str,
    started_at: str,
) -> None:
    if not artist or not title:
        return

    timestamp = None
    if started_at:
        try:
            timestamp = int(datetime.fromisoformat(started_at).timestamp())
        except ValueError:
            timestamp = None

    try:
        from crate.actors import scrobble_play_event_actor

        scrobble_play_event_actor.send(user_id, artist, title, album, timestamp)
    except Exception:
        log.warning("Failed to dispatch scrobble follow-up", exc_info=True)


def _schedule_play_event_followups(
    user_id: int,
    *,
    title: str,
    artist: str,
    album: str,
    started_at: str,
    was_completed: bool,
) -> None:
    try:
        _schedule_stats_refresh(user_id)
    except Exception:
        pass

    if was_completed:
        _queue_scrobble(
            user_id,
            artist=artist,
            title=title,
            album=album,
            started_at=started_at,
        )


def record_play(
    user_id: int,
    track_path: str = "",
    title: str = "",
    artist: str = "",
    album: str = "",
    track_id: int | None = None,
    track_entity_uid: str | None = None,
):
    now = utc_now_iso()
    with transaction_scope() as session:
        resolved_track = resolve_track_reference(
            session,
            track_id=track_id,
            track_entity_uid=track_entity_uid,
            track_path=track_path,
        )
        resolved_track_id = resolved_track["track_id"] if resolved_track else None
        resolved_track_entity_uid = (resolved_track or {}).get("track_entity_uid") or track_entity_uid
        resolved_track_path = track_path or (resolved_track or {}).get("track_path") or ""
        session.execute(
            text(
                """
                INSERT INTO play_history (user_id, track_id, track_entity_uid, track_path, title, artist, album, played_at)
                VALUES (:user_id, :track_id, :track_entity_uid, :track_path, :title, :artist, :album, :played_at)
                """
            ),
            {
                "user_id": user_id,
                "track_id": resolved_track_id,
                "track_entity_uid": resolved_track_entity_uid,
                "track_path": resolved_track_path,
                "title": title,
                "artist": artist,
                "album": album,
                "played_at": now,
            },
        )
        emit_user_domain_event(
            session,
            event_type="user.history.changed",
            user_id=user_id,
            payload={
                "track_id": resolved_track_id,
                "track_entity_uid": resolved_track_entity_uid,
                "artist": artist,
                "album": album,
                "title": title,
            },
        )


def record_play_event(
    user_id: int,
    *,
    client_event_id: str | None = None,
    track_id: int | None = None,
    track_entity_uid: str | None = None,
    track_path: str | None = None,
    title: str = "",
    artist: str = "",
    album: str = "",
    started_at: str,
    ended_at: str,
    played_seconds: float,
    track_duration_seconds: float | None = None,
    completion_ratio: float | None = None,
    was_skipped: bool = False,
    was_completed: bool = False,
    play_source_type: str | None = None,
    play_source_id: str | None = None,
    play_source_name: str | None = None,
    context_artist: str | None = None,
    context_album: str | None = None,
    context_playlist_id: int | None = None,
    device_type: str | None = None,
    app_platform: str | None = None,
) -> int:
    created_at = utc_now_iso()
    with transaction_scope() as session:
        if client_event_id:
            existing = session.execute(
                text(
                    """
                    SELECT id
                    FROM user_play_events
                    WHERE user_id = :user_id
                      AND client_event_id = :client_event_id
                    LIMIT 1
                    """
                ),
                {"user_id": user_id, "client_event_id": client_event_id},
            ).mappings().first()
            if existing:
                return int(existing["id"])

        resolved_track = resolve_track_reference(
            session,
            track_id=track_id,
            track_entity_uid=track_entity_uid,
            track_path=track_path,
        )
        resolved_track_id = resolved_track["track_id"] if resolved_track else None
        resolved_track_entity_uid = (resolved_track or {}).get("track_entity_uid") or track_entity_uid
        resolved_track_path = track_path or (resolved_track or {}).get("track_path")
        row = session.execute(
            text(
                """
                INSERT INTO user_play_events (
                    user_id,
                    client_event_id,
                    track_id,
                    track_entity_uid,
                    track_path,
                    title,
                    artist,
                    album,
                    started_at,
                    ended_at,
                    played_seconds,
                    track_duration_seconds,
                    completion_ratio,
                    was_skipped,
                    was_completed,
                    play_source_type,
                    play_source_id,
                    play_source_name,
                    context_artist,
                    context_album,
                    context_playlist_id,
                    device_type,
                    app_platform,
                    created_at
                )
                VALUES (
                    :user_id, :client_event_id, :track_id, :track_entity_uid, :track_path, :title, :artist, :album,
                    :started_at, :ended_at, :played_seconds, :track_duration_seconds,
                    :completion_ratio, :was_skipped, :was_completed,
                    :play_source_type, :play_source_id, :play_source_name,
                    :context_artist, :context_album, :context_playlist_id,
                    :device_type, :app_platform, :created_at
                )
                RETURNING id
                """
            ),
            {
                "user_id": user_id,
                "client_event_id": client_event_id,
                "track_id": resolved_track_id,
                "track_entity_uid": resolved_track_entity_uid,
                "track_path": resolved_track_path,
                "title": title,
                "artist": artist,
                "album": album,
                "started_at": started_at,
                "ended_at": ended_at,
                "played_seconds": played_seconds,
                "track_duration_seconds": track_duration_seconds,
                "completion_ratio": completion_ratio,
                "was_skipped": was_skipped,
                "was_completed": was_completed,
                "play_source_type": play_source_type,
                "play_source_id": play_source_id,
                "play_source_name": play_source_name,
                "context_artist": context_artist,
                "context_album": context_album,
                "context_playlist_id": context_playlist_id,
                "device_type": device_type,
                "app_platform": app_platform,
                "created_at": created_at,
            },
        ).mappings().first()
        event_id = row["id"]

        emit_user_domain_event(
            session,
            event_type="user.play_event.recorded",
            user_id=user_id,
            payload={
                "event_id": event_id,
                "client_event_id": client_event_id,
                "track_id": resolved_track_id,
                "track_entity_uid": resolved_track_entity_uid,
                "title": title,
                "artist": artist,
                "album": album,
                "played_seconds": played_seconds,
                "was_completed": was_completed,
                "was_skipped": was_skipped,
                "play_source_type": play_source_type,
            },
        )
        register_after_commit(
            session,
            lambda: _schedule_play_event_followups(
                user_id,
                title=title,
                artist=artist,
                album=album,
                started_at=started_at,
                was_completed=was_completed,
            ),
        )

        return event_id


__all__ = [
    "record_play",
    "record_play_event",
]
