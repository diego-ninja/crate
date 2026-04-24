"""Quarantine helpers for library repository writes."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import delete
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryAlbum, LibraryTrack
from crate.db.tx import optional_scope


def quarantine_album(album_id: int, task_id: str, *, session: Session | None = None) -> bool:
    def _impl(s: Session) -> bool:
        album = s.get(LibraryAlbum, album_id)
        if album is None or album.quarantined_at is not None:
            return False
        album.quarantined_at = datetime.now(timezone.utc)
        album.quarantine_task_id = task_id
        return True

    with optional_scope(session) as s:
        return _impl(s)


def unquarantine_album(album_id: int, *, session: Session | None = None) -> bool:
    def _impl(s: Session) -> bool:
        album = s.get(LibraryAlbum, album_id)
        if album is None:
            return False
        album.quarantined_at = None
        album.quarantine_task_id = None
        return True

    with optional_scope(session) as s:
        return _impl(s)


def delete_quarantined_album(album_id: int, *, session: Session | None = None) -> dict | None:
    def _impl(s: Session) -> dict | None:
        album = s.get(LibraryAlbum, album_id)
        if album is None or album.quarantined_at is None:
            return None
        payload = {"id": album.id, "path": album.path, "artist": album.artist}
        s.execute(delete(LibraryTrack).where(LibraryTrack.album_id == album_id))
        s.execute(delete(LibraryAlbum).where(LibraryAlbum.id == album_id))
        return payload

    with optional_scope(session) as s:
        return _impl(s)


__all__ = ["delete_quarantined_album", "quarantine_album", "unquarantine_album"]
