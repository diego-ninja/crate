"""Track mutation helpers for playlist repository modules."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from crate.db.orm.playlist import Playlist, PlaylistTrack
from crate.db.repositories.library_track_reads import (
    resolve_library_track_reference,
)
from crate.db.repositories.playlists_shared import emit_playlist_domain_event
from crate.db.tx import optional_scope


def _resolve_playlist_track(track: dict, *, session: Session) -> dict:
    track_id = track.get("track_id") or track.get("libraryTrackId")
    track_entity_uid = (
        track.get("track_entity_uid")
        or track.get("entity_uid")
        or track.get("trackEntityUid")
        or track.get("entityUid")
    )
    track_storage_id = (
        track.get("track_storage_id")
        or track.get("trackStorageId")
    )
    track_path = track.get("track_path") or track.get("path") or ""

    library_track = resolve_library_track_reference(
        track_id=int(track_id) if track_id is not None else None,
        track_entity_uid=str(track_entity_uid) if track_entity_uid else None,
        track_storage_id=str(track_storage_id) if track_storage_id else None,
        track_path=track_path or None,
        session=session,
    )

    if library_track:
        resolved_entity_uid = library_track.get("entity_uid") or track_entity_uid
        return {
            "track_id": library_track.get("id"),
            "track_entity_uid": resolved_entity_uid,
            "track_storage_id": None if resolved_entity_uid else (library_track.get("storage_id") or track_storage_id),
            "track_path": library_track.get("path") or track_path,
            "title": track.get("title") or library_track.get("title") or library_track.get("filename") or "",
            "artist": track.get("artist") or library_track.get("artist") or "",
            "album": track.get("album") or library_track.get("album") or "",
            "duration": float(track.get("duration") or library_track.get("duration") or 0),
        }

    return {
        "track_id": track_id,
        "track_entity_uid": track_entity_uid,
        "track_storage_id": None if track_entity_uid else track_storage_id,
        "track_path": track_path,
        "title": track.get("title", ""),
        "artist": track.get("artist", ""),
        "album": track.get("album", ""),
        "duration": float(track.get("duration") or 0),
    }


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
            resolved = _resolve_playlist_track(track, session=s)
            s.add(
                PlaylistTrack(
                    playlist_id=playlist_id,
                    track_id=resolved["track_id"],
                    track_entity_uid=resolved["track_entity_uid"],
                    track_storage_id=resolved["track_storage_id"],
                    track_path=resolved["track_path"],
                    title=resolved["title"],
                    artist=resolved["artist"],
                    album=resolved["album"],
                    duration=resolved["duration"],
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
            resolved = _resolve_playlist_track(track, session=s)
            s.add(
                PlaylistTrack(
                    playlist_id=playlist_id,
                    track_id=resolved["track_id"],
                    track_entity_uid=resolved["track_entity_uid"],
                    track_storage_id=resolved["track_storage_id"],
                    track_path=resolved["track_path"],
                    title=resolved["title"],
                    artist=resolved["artist"],
                    album=resolved["album"],
                    duration=resolved["duration"],
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
