from __future__ import annotations

from datetime import datetime

from sqlalchemy import text

from crate.db.repositories.user_library_shared import emit_user_domain_event, resolve_track_id, utc_now_iso
from crate.db.tx import transaction_scope


def follow_artist(user_id: int, artist_name: str) -> bool:
    now = utc_now_iso()
    with transaction_scope() as session:
        result = session.execute(
            text(
                """
                INSERT INTO user_follows (user_id, artist_name, created_at)
                VALUES (:user_id, :artist_name, :created_at)
                ON CONFLICT DO NOTHING
                """
            ),
            {"user_id": user_id, "artist_name": artist_name, "created_at": now},
        )
        if result.rowcount > 0:
            emit_user_domain_event(
                session,
                event_type="user.follows.changed",
                user_id=user_id,
                payload={"action": "follow", "artist_name": artist_name},
            )
        return result.rowcount > 0


def unfollow_artist(user_id: int, artist_name: str) -> bool:
    with transaction_scope() as session:
        result = session.execute(
            text("DELETE FROM user_follows WHERE user_id = :user_id AND artist_name = :artist_name"),
            {"user_id": user_id, "artist_name": artist_name},
        )
        if result.rowcount > 0:
            emit_user_domain_event(
                session,
                event_type="user.follows.changed",
                user_id=user_id,
                payload={"action": "unfollow", "artist_name": artist_name},
            )
        return result.rowcount > 0


def save_album(user_id: int, album_id: int) -> bool:
    now = utc_now_iso()
    with transaction_scope() as session:
        result = session.execute(
            text(
                """
                INSERT INTO user_saved_albums (user_id, album_id, created_at)
                VALUES (:user_id, :album_id, :created_at)
                ON CONFLICT DO NOTHING
                """
            ),
            {"user_id": user_id, "album_id": album_id, "created_at": now},
        )
        if result.rowcount > 0:
            emit_user_domain_event(
                session,
                event_type="user.saved_albums.changed",
                user_id=user_id,
                payload={"action": "save", "album_id": album_id},
            )
        return result.rowcount > 0


def unsave_album(user_id: int, album_id: int) -> bool:
    with transaction_scope() as session:
        result = session.execute(
            text("DELETE FROM user_saved_albums WHERE user_id = :user_id AND album_id = :album_id"),
            {"user_id": user_id, "album_id": album_id},
        )
        if result.rowcount > 0:
            emit_user_domain_event(
                session,
                event_type="user.saved_albums.changed",
                user_id=user_id,
                payload={"action": "unsave", "album_id": album_id},
            )
        return result.rowcount > 0


def like_track(
    user_id: int,
    track_id: int | None = None,
    track_path: str | None = None,
    track_storage_id: str | None = None,
) -> bool | None:
    now = utc_now_iso()
    with transaction_scope() as session:
        resolved_track_id = resolve_track_id(
            session,
            track_id=track_id,
            track_path=track_path,
            track_storage_id=track_storage_id,
        )
        if not resolved_track_id:
            return None
        result = session.execute(
            text(
                """
                INSERT INTO user_liked_tracks (user_id, track_id, created_at)
                VALUES (:user_id, :track_id, :created_at)
                ON CONFLICT DO NOTHING
                """
            ),
            {"user_id": user_id, "track_id": resolved_track_id, "created_at": now},
        )
        if result.rowcount > 0:
            emit_user_domain_event(
                session,
                event_type="user.likes.changed",
                user_id=user_id,
                payload={"action": "like", "track_id": resolved_track_id},
            )
        return result.rowcount > 0


def unlike_track(
    user_id: int,
    track_id: int | None = None,
    track_path: str | None = None,
    track_storage_id: str | None = None,
) -> bool:
    with transaction_scope() as session:
        resolved_track_id = resolve_track_id(
            session,
            track_id=track_id,
            track_path=track_path,
            track_storage_id=track_storage_id,
        )
        if not resolved_track_id:
            return False
        result = session.execute(
            text("DELETE FROM user_liked_tracks WHERE user_id = :user_id AND track_id = :track_id"),
            {"user_id": user_id, "track_id": resolved_track_id},
        )
        if result.rowcount > 0:
            emit_user_domain_event(
                session,
                event_type="user.likes.changed",
                user_id=user_id,
                payload={"action": "unlike", "track_id": resolved_track_id},
            )
        return result.rowcount > 0


def record_play(
    user_id: int,
    track_path: str = "",
    title: str = "",
    artist: str = "",
    album: str = "",
    track_id: int | None = None,
    track_storage_id: str | None = None,
):
    now = utc_now_iso()
    with transaction_scope() as session:
        resolved_track_id = resolve_track_id(
            session,
            track_id=track_id,
            track_path=track_path,
            track_storage_id=track_storage_id,
        )
        session.execute(
            text(
                """
                INSERT INTO play_history (user_id, track_id, track_path, title, artist, album, played_at)
                VALUES (:user_id, :track_id, :track_path, :title, :artist, :album, :played_at)
                """
            ),
            {
                "user_id": user_id,
                "track_id": resolved_track_id,
                "track_path": track_path,
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
            payload={"track_id": resolved_track_id, "artist": artist, "album": album, "title": title},
        )


def record_play_event(
    user_id: int,
    *,
    track_id: int | None = None,
    track_path: str | None = None,
    track_storage_id: str | None = None,
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
        resolved_track_id = resolve_track_id(
            session,
            track_id=track_id,
            track_path=track_path,
            track_storage_id=track_storage_id,
        )
        row = session.execute(
            text(
                """
                INSERT INTO user_play_events (
                    user_id,
                    track_id,
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
                    :user_id, :track_id, :track_path, :title, :artist, :album,
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
                "track_id": resolved_track_id,
                "track_path": track_path,
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

        if was_completed and title and artist:
            try:
                from crate.scrobble import scrobble_play_event

                scrobble_play_event(
                    user_id,
                    artist=artist,
                    track=title,
                    album=album,
                    timestamp=int(datetime.fromisoformat(started_at).timestamp()) if started_at else None,
                )
            except Exception:
                pass

        emit_user_domain_event(
            session,
            event_type="user.history.changed",
            user_id=user_id,
            payload={
                "event_id": event_id,
                "track_id": resolved_track_id,
                "was_completed": was_completed,
                "was_skipped": was_skipped,
                "play_source_type": play_source_type,
            },
        )

        return event_id


__all__ = [
    "follow_artist",
    "like_track",
    "record_play",
    "record_play_event",
    "save_album",
    "unfollow_artist",
    "unlike_track",
    "unsave_album",
]
