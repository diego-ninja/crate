"""Artist catalog lookup helpers for the library repository."""

from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryArtist
from crate.db.repositories.library_shared import artist_to_dict
from crate.db.tx import read_scope


def get_library_artists(
    q: str | None = None,
    sort: str = "name",
    page: int = 1,
    per_page: int = 60,
    *,
    session: Session | None = None,
) -> tuple[list[dict], int]:
    def impl(s: Session) -> tuple[list[dict], int]:
        base = select(LibraryArtist)
        count_stmt = select(func.count()).select_from(LibraryArtist)
        if q:
            like = f"%{q}%"
            predicate = LibraryArtist.name.ilike(like)
            base = base.where(predicate)
            count_stmt = count_stmt.where(predicate)

        sort_map = {
            "name": LibraryArtist.name.asc(),
            "albums": LibraryArtist.album_count.desc(),
            "tracks": LibraryArtist.track_count.desc(),
            "size": LibraryArtist.total_size.desc(),
            "updated": LibraryArtist.updated_at.desc(),
        }
        rows = s.execute(
            base.order_by(sort_map.get(sort, LibraryArtist.name.asc())).limit(per_page).offset((page - 1) * per_page)
        ).scalars().all()
        total = int(s.execute(count_stmt).scalar_one() or 0)
        return [artist_to_dict(row) for row in rows], total

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


def get_library_artist(name: str, *, session: Session | None = None) -> dict | None:
    def impl(s: Session) -> dict | None:
        row = s.execute(
            select(LibraryArtist).where(
                or_(
                    func.lower(LibraryArtist.name) == func.lower(name),
                    LibraryArtist.folder_name == name,
                )
            ).limit(1)
        ).scalar_one_or_none()
        return artist_to_dict(row)

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


def get_library_artist_by_id(artist_id: int, *, session: Session | None = None) -> dict | None:
    def impl(s: Session) -> dict | None:
        row = s.get(LibraryArtist, artist_id)
        return artist_to_dict(row)

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


def get_library_artist_by_entity_uid(artist_entity_uid: str, *, session: Session | None = None) -> dict | None:
    def impl(s: Session) -> dict | None:
        row = (
            s.execute(
                select(LibraryArtist)
                .where(LibraryArtist.entity_uid == artist_entity_uid)
                .limit(1)
            )
            .scalar_one_or_none()
        )
        return artist_to_dict(row)

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


def get_library_artist_by_slug(slug: str, *, session: Session | None = None) -> dict | None:
    def impl(s: Session) -> dict | None:
        row = s.execute(select(LibraryArtist).where(LibraryArtist.slug == slug).limit(1)).scalar_one_or_none()
        return artist_to_dict(row)

    if session is not None:
        return impl(session)
    with read_scope() as s:
        return impl(s)


__all__ = [
    "get_library_artist",
    "get_library_artist_by_entity_uid",
    "get_library_artist_by_id",
    "get_library_artist_by_slug",
    "get_library_artists",
]
