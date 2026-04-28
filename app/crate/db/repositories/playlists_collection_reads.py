"""Collection and system playlist read helpers."""

from __future__ import annotations

from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from crate.db.orm.playlist import Playlist, PlaylistMember, UserFollowedPlaylist
from crate.db.repositories.playlists_shared import attach_artwork_tracks, fetch_artwork_tracks_for_playlists, playlist_to_dict
from crate.db.tx import read_scope


def get_playlists(user_id: int | None = None, *, session: Session | None = None) -> list[dict]:
    def _impl(s: Session) -> list[dict]:
        stmt = select(Playlist)
        if user_id is not None:
            stmt = (
                stmt.outerjoin(PlaylistMember, PlaylistMember.playlist_id == Playlist.id)
                .where(or_(Playlist.user_id == user_id, PlaylistMember.user_id == user_id))
                .distinct()
            )
        rows = s.execute(stmt.order_by(Playlist.updated_at.desc())).scalars().all()
        return attach_artwork_tracks(s, [playlist_to_dict(row) for row in rows if row is not None])

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_playlist(playlist_id: int, *, session: Session | None = None) -> dict | None:
    def _impl(s: Session) -> dict | None:
        row = s.get(Playlist, playlist_id)
        if row is None:
            return None
        playlist = playlist_to_dict(row)
        playlist["artwork_tracks"] = fetch_artwork_tracks_for_playlists(s, [playlist_id]).get(playlist_id, [])
        return playlist

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def list_system_playlists(
    *,
    only_curated: bool = False,
    only_active: bool = True,
    category: str | None = None,
    user_id: int | None = None,
    session: Session | None = None,
) -> list[dict]:
    def _impl(s: Session) -> list[dict]:
        followers = (
            select(
                UserFollowedPlaylist.playlist_id.label("playlist_id"),
                func.count().label("follower_count"),
            )
            .group_by(UserFollowedPlaylist.playlist_id)
            .subquery()
        )
        columns = [
            Playlist,
            func.coalesce(followers.c.follower_count, 0).label("follower_count"),
        ]
        if user_id is not None:
            followed = (
                select(UserFollowedPlaylist.playlist_id)
                .where(
                    UserFollowedPlaylist.playlist_id == Playlist.id,
                    UserFollowedPlaylist.user_id == user_id,
                )
                .exists()
            )
            columns.append(followed.label("is_followed"))

        stmt = (
            select(*columns)
            .outerjoin(followers, followers.c.playlist_id == Playlist.id)
            .where(Playlist.scope == "system")
        )
        if only_curated:
            stmt = stmt.where(Playlist.is_curated.is_(True))
        if only_active:
            stmt = stmt.where(Playlist.is_active.is_(True))
        if category:
            stmt = stmt.where(Playlist.category == category)
        rows = s.execute(stmt.order_by(Playlist.featured_rank.asc().nulls_last(), Playlist.updated_at.desc())).all()

        results: list[dict] = []
        for row in rows:
            playlist = playlist_to_dict(row[0])
            playlist["follower_count"] = int(row[1] or 0)
            if user_id is not None:
                playlist["is_followed"] = bool(row[2])
            results.append(playlist)
        return attach_artwork_tracks(s, results)

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_playlist_followers_count(playlist_id: int, *, session: Session | None = None) -> int:
    def _impl(s: Session) -> int:
        return int(
            s.execute(
                select(func.count()).select_from(UserFollowedPlaylist).where(UserFollowedPlaylist.playlist_id == playlist_id)
            ).scalar_one()
            or 0
        )

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_followed_system_playlists(user_id: int, *, session: Session | None = None) -> list[dict]:
    def _impl(s: Session) -> list[dict]:
        followers = (
            select(
                UserFollowedPlaylist.playlist_id.label("playlist_id"),
                func.count().label("follower_count"),
            )
            .group_by(UserFollowedPlaylist.playlist_id)
            .subquery()
        )
        stmt = (
            select(
                Playlist,
                UserFollowedPlaylist.followed_at,
                func.coalesce(followers.c.follower_count, 0).label("follower_count"),
            )
            .join(UserFollowedPlaylist, UserFollowedPlaylist.playlist_id == Playlist.id)
            .outerjoin(followers, followers.c.playlist_id == Playlist.id)
            .where(
                UserFollowedPlaylist.user_id == user_id,
                Playlist.scope == "system",
                Playlist.is_active.is_(True),
            )
            .order_by(UserFollowedPlaylist.followed_at.desc())
        )
        rows = s.execute(stmt).all()
        results: list[dict] = []
        for playlist_row, followed_at, follower_count in rows:
            playlist = playlist_to_dict(playlist_row)
            playlist["is_followed"] = True
            playlist["followed_at"] = followed_at
            playlist["follower_count"] = int(follower_count or 0)
            results.append(playlist)
        return attach_artwork_tracks(s, results)

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def is_playlist_followed(user_id: int, playlist_id: int, *, session: Session | None = None) -> bool:
    def _impl(s: Session) -> bool:
        return s.get(UserFollowedPlaylist, {"user_id": user_id, "playlist_id": playlist_id}) is not None

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_smart_playlists_for_refresh() -> list[dict]:
    with read_scope() as s:
        rows = s.execute(
            select(Playlist)
            .where(
                Playlist.scope == "system",
                Playlist.generation_mode == "smart",
                Playlist.is_active.is_(True),
                Playlist.auto_refresh_enabled.is_(True),
                or_(Playlist.last_generated_at.is_(None), Playlist.last_generated_at < func.now() - text("interval '24 hours'")),
            )
            .order_by(Playlist.last_generated_at.asc().nulls_first())
        ).scalars().all()
        results = [playlist_to_dict(row) for row in rows]
        return attach_artwork_tracks(s, [row for row in results if row is not None])


__all__ = [
    "get_followed_system_playlists",
    "get_playlist",
    "get_playlist_followers_count",
    "get_playlists",
    "get_smart_playlists_for_refresh",
    "is_playlist_followed",
    "list_system_playlists",
]
