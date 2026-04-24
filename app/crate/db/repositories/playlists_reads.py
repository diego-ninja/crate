"""Read-side helpers for playlist repository modules."""

from __future__ import annotations

import json

from sqlalchemy import exists, func, or_, select, text
from sqlalchemy.orm import Session

from crate.db.orm.playlist import Playlist, PlaylistMember, PlaylistTrack, UserFollowedPlaylist
from crate.db.orm.user import User
from crate.db.repositories.playlists_shared import attach_artwork_tracks, fetch_artwork_tracks_for_playlists, normalize_playlist_row, playlist_to_dict
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


def get_playlist_members(playlist_id: int, *, session: Session | None = None) -> list[dict]:
    def _impl(s: Session) -> list[dict]:
        rows = s.execute(
            select(
                PlaylistMember.playlist_id,
                PlaylistMember.user_id,
                PlaylistMember.role,
                PlaylistMember.invited_by,
                PlaylistMember.created_at,
                User.username,
                User.name.label("display_name"),
                User.avatar,
            )
            .join(User, User.id == PlaylistMember.user_id)
            .where(PlaylistMember.playlist_id == playlist_id)
            .order_by((PlaylistMember.role == "owner").desc(), PlaylistMember.created_at.asc())
        ).mappings().all()
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_playlist_member(playlist_id: int, user_id: int, *, session: Session | None = None) -> dict | None:
    def _impl(s: Session) -> dict | None:
        member = s.get(PlaylistMember, {"playlist_id": playlist_id, "user_id": user_id})
        if member is None:
            return None
        return {
            "playlist_id": member.playlist_id,
            "user_id": member.user_id,
            "role": member.role,
            "invited_by": member.invited_by,
            "created_at": member.created_at,
        }

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def can_view_playlist(playlist: dict | None, user_id: int | None, *, session: Session | None = None) -> bool:
    if not playlist:
        return False
    if playlist.get("scope") == "system":
        return True
    if playlist.get("visibility") == "public":
        return True
    if user_id is None:
        return False
    if playlist.get("user_id") == user_id:
        return True
    return get_playlist_member(int(playlist["id"]), user_id, session=session) is not None


def can_edit_playlist(playlist: dict | None, user_id: int | None, *, session: Session | None = None) -> bool:
    if not playlist or user_id is None:
        return False
    if playlist.get("scope") == "system":
        return False
    if playlist.get("user_id") == user_id:
        return True
    member = get_playlist_member(int(playlist["id"]), user_id, session=session)
    return bool(member and member.get("role") in {"owner", "collab"})


def is_playlist_owner(playlist: dict | None, user_id: int | None, *, session: Session | None = None) -> bool:
    if not playlist or user_id is None:
        return False
    if playlist.get("user_id") == user_id:
        return True
    member = get_playlist_member(int(playlist["id"]), user_id, session=session)
    return bool(member and member.get("role") == "owner")


def get_playlist_tracks(playlist_id: int, *, session: Session | None = None) -> list[dict]:
    def _impl(s: Session) -> list[dict]:
        rows = s.execute(
            text(
                """
                SELECT
                    pt.*,
                    lt.id AS track_id,
                    lt.storage_id::text AS track_storage_id,
                    ar.id AS artist_id,
                    ar.slug AS artist_slug,
                    alb.id AS album_id,
                    alb.slug AS album_slug
                FROM playlist_tracks pt
                LEFT JOIN LATERAL (
                    SELECT id, storage_id::text, path, artist, album, album_id
                    FROM library_tracks lt
                    WHERE lt.id = pt.track_id
                       OR lt.path = pt.track_path
                       OR lt.path LIKE ('%/' || pt.track_path)
                    ORDER BY CASE WHEN lt.id = pt.track_id THEN 0 WHEN lt.path = pt.track_path THEN 1 ELSE 2 END
                    LIMIT 1
                ) lt ON TRUE
                LEFT JOIN library_albums alb
                  ON alb.id = lt.album_id
                  OR (lt.album_id IS NULL AND alb.artist = COALESCE(lt.artist, pt.artist) AND alb.name = COALESCE(lt.album, pt.album))
                LEFT JOIN library_artists ar ON ar.name = COALESCE(lt.artist, pt.artist)
                WHERE pt.playlist_id = :playlist_id
                ORDER BY pt.position
                """
            ),
            {"playlist_id": playlist_id},
        ).mappings().all()
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_playlist_filter_options() -> dict:
    with read_scope() as s:
        formats = [
            row["format"]
            for row in s.execute(
                text("SELECT DISTINCT format FROM library_tracks WHERE format IS NOT NULL AND format != '' ORDER BY format")
            ).mappings().all()
        ]
        keys = [
            row["audio_key"]
            for row in s.execute(
                text(
                    "SELECT DISTINCT audio_key FROM library_tracks WHERE audio_key IS NOT NULL AND audio_key != '' ORDER BY audio_key"
                )
            ).mappings().all()
        ]
        scales = [
            row["audio_scale"]
            for row in s.execute(
                text(
                    "SELECT DISTINCT audio_scale FROM library_tracks WHERE audio_scale IS NOT NULL AND audio_scale != '' ORDER BY audio_scale"
                )
            ).mappings().all()
        ]
        artists = [
            row["name"]
            for row in s.execute(text("SELECT name FROM library_artists ORDER BY name")).mappings().all()
        ]
        year_row = s.execute(
            text("SELECT MIN(year) AS min_y, MAX(year) AS max_y FROM library_tracks WHERE year IS NOT NULL AND year != ''")
        ).mappings().first()
        bpm_row = s.execute(
            text("SELECT MIN(bpm) AS min_b, MAX(bpm) AS max_b FROM library_tracks WHERE bpm IS NOT NULL")
        ).mappings().first()

    return {
        "formats": formats,
        "keys": keys,
        "scales": scales,
        "artists": artists,
        "year_range": [year_row["min_y"] or "1960", year_row["max_y"] or "2026"],
        "bpm_range": [int(bpm_row["min_b"] or 60), int(bpm_row["max_b"] or 200)],
    }


def get_generation_history(playlist_id: int, limit: int = 5) -> list[dict]:
    with read_scope() as s:
        rows = s.execute(
            text(
                """
                SELECT *
                FROM playlist_generation_log
                WHERE playlist_id = :playlist_id
                ORDER BY started_at DESC
                LIMIT :limit
                """
            ),
            {"playlist_id": playlist_id, "limit": limit},
        ).mappings().all()
    results: list[dict] = []
    for row in rows:
        item = dict(row)
        snapshot = item.pop("rule_snapshot_json", None)
        item["rule_snapshot"] = snapshot if isinstance(snapshot, dict) else (json.loads(snapshot) if snapshot else None)
        for key in ("started_at", "completed_at"):
            if hasattr(item.get(key), "isoformat"):
                item[key] = item[key].isoformat()
        results.append(item)
    return results


def get_smart_playlists_for_refresh() -> list[dict]:
    with read_scope() as s:
        rows = s.execute(
            text(
                """
                SELECT *
                FROM playlists
                WHERE scope = 'system'
                  AND generation_mode = 'smart'
                  AND is_active = TRUE
                  AND auto_refresh_enabled = TRUE
                  AND (last_generated_at IS NULL OR last_generated_at < now() - interval '24 hours')
                ORDER BY last_generated_at NULLS FIRST
                """
            )
        ).mappings().all()
        results = [normalize_playlist_row(row) for row in rows]
        return attach_artwork_tracks(s, [row for row in results if row is not None])


__all__ = [
    "can_edit_playlist",
    "can_view_playlist",
    "get_followed_system_playlists",
    "get_generation_history",
    "get_playlist",
    "get_playlist_filter_options",
    "get_playlist_followers_count",
    "get_playlist_member",
    "get_playlist_members",
    "get_playlist_tracks",
    "get_playlists",
    "get_smart_playlists_for_refresh",
    "is_playlist_followed",
    "is_playlist_owner",
    "list_system_playlists",
]
