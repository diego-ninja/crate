"""Follow/member helpers for playlist repository modules."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from crate.db.orm.playlist import Playlist, PlaylistMember, UserFollowedPlaylist
from crate.db.repositories.playlists_shared import emit_playlist_domain_event
from crate.db.tx import optional_scope


def follow_playlist(user_id: int, playlist_id: int, *, session: Session | None = None) -> bool:
    def _impl(s: Session) -> bool:
        playlist_exists = s.execute(
            select(exists().where(Playlist.id == playlist_id, Playlist.scope == "system", Playlist.is_active.is_(True)))
        ).scalar_one()
        if not playlist_exists:
            return False
        existing = s.get(UserFollowedPlaylist, {"user_id": user_id, "playlist_id": playlist_id})
        if existing is not None:
            return False
        s.add(
            UserFollowedPlaylist(
                user_id=user_id,
                playlist_id=playlist_id,
                followed_at=datetime.now(timezone.utc),
            )
        )
        emit_playlist_domain_event(
            s,
            playlist_id=playlist_id,
            action="followed",
            payload={"user_id": user_id},
        )
        return True

    with optional_scope(session) as s:
        return _impl(s)


def unfollow_playlist(user_id: int, playlist_id: int, *, session: Session | None = None) -> bool:
    def _impl(s: Session) -> bool:
        existing = s.get(UserFollowedPlaylist, {"user_id": user_id, "playlist_id": playlist_id})
        if existing is None:
            return False
        s.delete(existing)
        emit_playlist_domain_event(
            s,
            playlist_id=playlist_id,
            action="unfollowed",
            payload={"user_id": user_id},
        )
        return True

    with optional_scope(session) as s:
        return _impl(s)


def add_playlist_member(
    playlist_id: int,
    user_id: int,
    role: str = "collab",
    invited_by: int | None = None,
    *,
    session: Session | None = None,
) -> bool:
    now = datetime.now(timezone.utc)

    def _impl(s: Session) -> bool:
        member = s.get(PlaylistMember, {"playlist_id": playlist_id, "user_id": user_id})
        if member is None:
            s.add(
                PlaylistMember(
                    playlist_id=playlist_id,
                    user_id=user_id,
                    role=role,
                    invited_by=invited_by,
                    created_at=now,
                )
            )
            return True
        member.role = role
        if invited_by is not None:
            member.invited_by = invited_by
        return True

    with optional_scope(session) as s:
        return _impl(s)


def remove_playlist_member(playlist_id: int, user_id: int, *, session: Session | None = None) -> bool:
    def _impl(s: Session) -> bool:
        member = s.get(PlaylistMember, {"playlist_id": playlist_id, "user_id": user_id})
        if member is None:
            return False
        s.delete(member)
        return True

    with optional_scope(session) as s:
        return _impl(s)


__all__ = ["add_playlist_member", "follow_playlist", "remove_playlist_member", "unfollow_playlist"]
