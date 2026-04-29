"""Album catalog lookup helpers for the library repository."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryAlbum
from crate.db.repositories.library_shared import album_to_dict
from crate.db.tx import read_scope


def get_library_albums(
    artist: str,
    include_quarantined: bool = False,
    *,
    session: Session | None = None,
) -> list[dict]:
    def impl(s: Session) -> list[dict]:
        stmt = select(LibraryAlbum).where(func.lower(LibraryAlbum.artist) == func.lower(artist))
        if not include_quarantined:
            stmt = stmt.where(LibraryAlbum.quarantined_at.is_(None))
        rows = s.execute(stmt.order_by(LibraryAlbum.year, LibraryAlbum.name)).scalars().all()
        return [album_to_dict(row) for row in rows]

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


def get_library_album(artist: str, album: str, *, session: Session | None = None) -> dict | None:
    def impl(s: Session) -> dict | None:
        row = s.execute(
            select(LibraryAlbum).where(
                func.lower(LibraryAlbum.artist) == func.lower(artist),
                func.lower(LibraryAlbum.name) == func.lower(album),
            ).limit(1)
        ).scalar_one_or_none()
        return album_to_dict(row)

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


def get_library_album_by_id(album_id: int, *, session: Session | None = None) -> dict | None:
    def impl(s: Session) -> dict | None:
        row = s.get(LibraryAlbum, album_id)
        return album_to_dict(row)

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


def get_library_album_by_entity_uid(album_entity_uid: str, *, session: Session | None = None) -> dict | None:
    def impl(s: Session) -> dict | None:
        row = (
            s.execute(
                select(LibraryAlbum)
                .where(LibraryAlbum.entity_uid == album_entity_uid)
                .limit(1)
            )
            .scalar_one_or_none()
        )
        return album_to_dict(row)

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


__all__ = [
    "get_library_album",
    "get_library_album_by_entity_uid",
    "get_library_album_by_id",
    "get_library_albums",
]
