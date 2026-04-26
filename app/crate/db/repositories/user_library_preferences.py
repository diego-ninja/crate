from __future__ import annotations

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


__all__ = [
    "follow_artist",
    "like_track",
    "save_album",
    "unfollow_artist",
    "unlike_track",
    "unsave_album",
]
