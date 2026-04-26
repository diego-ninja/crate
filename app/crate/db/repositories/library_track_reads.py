"""Track catalog lookup helpers for the library repository."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryTrack
from crate.db.repositories.library_shared import coerce_uuid, track_to_dict
from crate.db.tx import read_scope


def get_library_tracks(album_id: int, *, session: Session | None = None) -> list[dict]:
    def impl(s: Session) -> list[dict]:
        rows = s.execute(
            select(LibraryTrack)
            .where(LibraryTrack.album_id == album_id)
            .order_by(LibraryTrack.disc_number, LibraryTrack.track_number)
        ).scalars().all()
        return [track_to_dict(row) for row in rows]

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


def get_library_track_by_id(track_id: int, *, session: Session | None = None) -> dict | None:
    def impl(s: Session) -> dict | None:
        row = s.get(LibraryTrack, track_id)
        return track_to_dict(row)

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


def get_library_track_by_storage_id(storage_id: str, *, session: Session | None = None) -> dict | None:
    def impl(s: Session) -> dict | None:
        row = s.execute(
            select(LibraryTrack).where(LibraryTrack.storage_id == coerce_uuid(storage_id)).limit(1)
        ).scalar_one_or_none()
        return track_to_dict(row)

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


def get_library_track_by_path(path: str, *, session: Session | None = None) -> dict | None:
    def impl(s: Session) -> dict | None:
        row = s.execute(select(LibraryTrack).where(LibraryTrack.path == path).limit(1)).scalar_one_or_none()
        return track_to_dict(row)

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


def get_library_tracks_by_storage_ids(storage_ids: list[str], *, session: Session | None = None) -> dict[str, dict]:
    cleaned_ids = [storage_id for storage_id in storage_ids if storage_id]
    if not cleaned_ids:
        return {}

    uuids = [coerce_uuid(storage_id) for storage_id in cleaned_ids]

    def impl(s: Session) -> dict[str, dict]:
        rows = s.execute(select(LibraryTrack).where(LibraryTrack.storage_id.in_(uuids))).scalars().all()
        return {str(row.storage_id): track_to_dict(row) for row in rows if row.storage_id is not None}

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


__all__ = [
    "get_library_track_by_id",
    "get_library_track_by_path",
    "get_library_track_by_storage_id",
    "get_library_tracks",
    "get_library_tracks_by_storage_ids",
]
