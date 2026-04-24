"""Track mutation helpers for playlist repository modules."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from crate.db.orm.playlist import Playlist, PlaylistTrack
from crate.db.repositories.playlists_shared import emit_playlist_domain_event
from crate.db.tx import optional_scope


def add_playlist_tracks(playlist_id: int, tracks: list[dict], *, session: Session | None = None) -> None:
    def _impl(s: Session) -> None:
        now = datetime.now(timezone.utc)
        max_position = int(
            s.execute(select(func.coalesce(func.max(PlaylistTrack.position), 0)).where(PlaylistTrack.playlist_id == playlist_id)).scalar_one()
            or 0
        )
        position = max_position
        for track in tracks:
            position += 1
            s.add(
                PlaylistTrack(
                    playlist_id=playlist_id,
                    track_id=track.get("track_id") or track.get("libraryTrackId"),
                    track_path=track.get("path") or "",
                    title=track.get("title", ""),
                    artist=track.get("artist", ""),
                    album=track.get("album", ""),
                    duration=track.get("duration", 0),
                    position=position,
                    added_at=now,
                )
            )
        playlist = s.get(Playlist, playlist_id)
        if playlist is not None:
            playlist.track_count = int(
                s.execute(select(func.count()).select_from(PlaylistTrack).where(PlaylistTrack.playlist_id == playlist_id)).scalar_one()
                or 0
            )
            playlist.total_duration = float(
                s.execute(select(func.coalesce(func.sum(PlaylistTrack.duration), 0)).where(PlaylistTrack.playlist_id == playlist_id)).scalar_one()
                or 0
            )
            playlist.updated_at = now
        emit_playlist_domain_event(
            s,
            playlist_id=playlist_id,
            action="tracks_added",
            payload={"track_count_delta": len(tracks)},
        )

    with optional_scope(session) as s:
        _impl(s)


def remove_playlist_track(playlist_id: int, position: int, *, session: Session | None = None) -> None:
    def _impl(s: Session) -> None:
        now = datetime.now(timezone.utc)
        s.execute(
            text("DELETE FROM playlist_tracks WHERE playlist_id = :playlist_id AND position = :position"),
            {"playlist_id": playlist_id, "position": position},
        )
        s.execute(
            text(
                "WITH ordered AS (SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS new_pos "
                "FROM playlist_tracks WHERE playlist_id = :playlist_id) "
                "UPDATE playlist_tracks SET position = ordered.new_pos "
                "FROM ordered WHERE playlist_tracks.id = ordered.id"
            ),
            {"playlist_id": playlist_id},
        )
        playlist = s.get(Playlist, playlist_id)
        if playlist is not None:
            playlist.track_count = int(
                s.execute(select(func.count()).select_from(PlaylistTrack).where(PlaylistTrack.playlist_id == playlist_id)).scalar_one()
                or 0
            )
            playlist.total_duration = float(
                s.execute(select(func.coalesce(func.sum(PlaylistTrack.duration), 0)).where(PlaylistTrack.playlist_id == playlist_id)).scalar_one()
                or 0
            )
            playlist.updated_at = now
        emit_playlist_domain_event(
            s,
            playlist_id=playlist_id,
            action="track_removed",
            payload={"position": position},
        )

    with optional_scope(session) as s:
        _impl(s)


def reorder_playlist(playlist_id: int, track_ids: list[int], *, session: Session | None = None) -> None:
    def _impl(s: Session) -> None:
        now = datetime.now(timezone.utc)
        for position, track_id in enumerate(track_ids, 1):
            s.execute(
                text("UPDATE playlist_tracks SET position = :pos WHERE id = :tid AND playlist_id = :playlist_id"),
                {"pos": position, "tid": track_id, "playlist_id": playlist_id},
            )
        playlist = s.get(Playlist, playlist_id)
        if playlist is not None:
            playlist.updated_at = now
        emit_playlist_domain_event(
            s,
            playlist_id=playlist_id,
            action="reordered",
            payload={"track_ids": list(track_ids)},
        )

    with optional_scope(session) as s:
        _impl(s)


def replace_playlist_tracks(playlist_id: int, tracks: list[dict], *, session: Session | None = None) -> None:
    def _impl(s: Session) -> None:
        now = datetime.now(timezone.utc)
        s.execute(text("DELETE FROM playlist_tracks WHERE playlist_id = :playlist_id"), {"playlist_id": playlist_id})

        position = 0
        for track in tracks:
            position += 1
            s.add(
                PlaylistTrack(
                    playlist_id=playlist_id,
                    track_id=track.get("track_id") or track.get("libraryTrackId"),
                    track_path=track.get("path") or "",
                    title=track.get("title", ""),
                    artist=track.get("artist", ""),
                    album=track.get("album", ""),
                    duration=track.get("duration", 0),
                    position=position,
                    added_at=now,
                )
            )

        playlist = s.get(Playlist, playlist_id)
        if playlist is not None:
            playlist.track_count = len(tracks)
            playlist.total_duration = float(sum(float(track.get("duration") or 0) for track in tracks))
            playlist.updated_at = now
        emit_playlist_domain_event(
            s,
            playlist_id=playlist_id,
            action="tracks_replaced",
            payload={"track_count": len(tracks)},
        )

    with optional_scope(session) as s:
        _impl(s)


__all__ = ["add_playlist_tracks", "remove_playlist_track", "replace_playlist_tracks", "reorder_playlist"]
