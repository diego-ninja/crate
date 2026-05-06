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


def resolve_library_track_reference(
    *,
    track_id: int | None = None,
    track_entity_uid: str | None = None,
    track_storage_id: str | None = None,
    track_path: str | None = None,
    session: Session | None = None,
) -> dict | None:
    def impl(s: Session) -> dict | None:
        if track_id is not None:
            track = get_library_track_by_id(int(track_id), session=s)
            if track is not None:
                return track
        if track_entity_uid:
            track = get_library_track_by_entity_uid(str(track_entity_uid), session=s)
            if track is not None:
                return track
        if track_storage_id:
            track = get_library_track_by_storage_id(str(track_storage_id), session=s)
            if track is not None:
                return track
        if track_path:
            track = get_library_track_by_path(str(track_path), session=s)
            if track is not None:
                return track
        return None

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


def get_library_track_by_entity_uid(entity_uid: str, *, session: Session | None = None) -> dict | None:
    def impl(s: Session) -> dict | None:
        row = s.execute(
            select(LibraryTrack).where(LibraryTrack.entity_uid == coerce_uuid(entity_uid)).limit(1)
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


def get_library_tracks_by_entity_uids(entity_uids: list[str], *, session: Session | None = None) -> dict[str, dict]:
    cleaned_ids = [entity_uid for entity_uid in entity_uids if entity_uid]
    if not cleaned_ids:
        return {}

    uuids = [coerce_uuid(entity_uid) for entity_uid in cleaned_ids]

    def impl(s: Session) -> dict[str, dict]:
        rows = s.execute(select(LibraryTrack).where(LibraryTrack.entity_uid.in_(uuids))).scalars().all()
        return {str(row.entity_uid): track_to_dict(row) for row in rows if row.entity_uid is not None}

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


__all__ = [
    "get_library_track_by_entity_uid",
    "get_library_track_by_id",
    "get_library_track_by_path",
    "get_library_track_by_storage_id",
    "get_library_tracks",
    "get_library_tracks_by_entity_uids",
    "get_library_tracks_by_storage_ids",
    "resolve_library_track_reference",
]
