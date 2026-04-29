from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import case, false, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryArtist
from crate.db.repositories.library_shared import allocate_unique_slug, coerce_uuid
from crate.db.tx import optional_scope
from crate.slugs import build_artist_slug


def _select_existing_artist(
    session: Session,
    *,
    requested_name: str,
    folder_name: str,
    requested_storage_id,
):
    storage_match = LibraryArtist.storage_id == requested_storage_id if requested_storage_id is not None else false()
    folder_match = LibraryArtist.folder_name == folder_name if folder_name else false()
    name_match = func.lower(LibraryArtist.name) == func.lower(requested_name)
    identity_match = or_(name_match, folder_match, storage_match)
    priority = case(
        (storage_match, 0),
        (folder_match, 1),
        (name_match, 2),
        else_=3,
    )
    return session.execute(
        select(
            LibraryArtist.id,
            LibraryArtist.name,
            LibraryArtist.slug,
            LibraryArtist.storage_id,
            LibraryArtist.folder_name,
        )
        .where(identity_match)
        .order_by(priority, LibraryArtist.id)
        .limit(1)
    ).first()


def _update_existing_artist(
    session: Session,
    *,
    artist_id: int,
    canonical_name: str,
    existing_slug: str | None,
    existing_storage_id,
    existing_folder_name: str | None,
    requested_storage_id,
    folder_name: str,
    data: dict,
    now: datetime,
) -> str:
    slug = existing_slug or allocate_unique_slug(session, LibraryArtist, build_artist_slug(canonical_name))
    session.execute(
        update(LibraryArtist)
        .where(LibraryArtist.id == artist_id)
        .values(
            storage_id=existing_storage_id or requested_storage_id,
            slug=slug,
            folder_name=existing_folder_name or folder_name,
            album_count=data.get("album_count", 0),
            track_count=data.get("track_count", 0),
            total_size=data.get("total_size", 0),
            formats_json=list(data.get("formats", [])),
            primary_format=data.get("primary_format"),
            has_photo=data.get("has_photo", 0),
            dir_mtime=data.get("dir_mtime"),
            updated_at=now,
        )
    )
    return canonical_name


def upsert_artist(data: dict, *, session: Session | None = None) -> str:
    with optional_scope(session) as s:
        now = datetime.now(timezone.utc)
        requested_name = str(data["name"]).strip()
        folder_name = str(data.get("folder_name") or requested_name).strip()
        requested_storage_id = coerce_uuid(data.get("storage_id"))
        existing = _select_existing_artist(
            s,
            requested_name=requested_name,
            folder_name=folder_name,
            requested_storage_id=requested_storage_id,
        )
        if existing:
            artist_id, canonical_name, existing_slug, existing_storage_id, existing_folder_name = existing
            return _update_existing_artist(
                s,
                artist_id=int(artist_id),
                canonical_name=canonical_name or requested_name,
                existing_slug=existing_slug,
                existing_storage_id=existing_storage_id,
                existing_folder_name=existing_folder_name,
                requested_storage_id=requested_storage_id,
                folder_name=folder_name,
                data=data,
                now=now,
            )

        slug = allocate_unique_slug(s, LibraryArtist, build_artist_slug(requested_name))
        insert_stmt = pg_insert(LibraryArtist).values(
            name=requested_name,
            storage_id=requested_storage_id,
            slug=slug,
            folder_name=folder_name,
            album_count=data.get("album_count", 0),
            track_count=data.get("track_count", 0),
            total_size=data.get("total_size", 0),
            formats_json=list(data.get("formats", [])),
            primary_format=data.get("primary_format"),
            has_photo=data.get("has_photo", 0),
            dir_mtime=data.get("dir_mtime"),
            updated_at=now,
        )
        try:
            with s.begin_nested():
                s.execute(insert_stmt)
        except IntegrityError:
            existing = _select_existing_artist(
                s,
                requested_name=requested_name,
                folder_name=folder_name,
                requested_storage_id=requested_storage_id,
            )
            if not existing:
                raise
            artist_id, canonical_name, existing_slug, existing_storage_id, existing_folder_name = existing
            return _update_existing_artist(
                s,
                artist_id=int(artist_id),
                canonical_name=canonical_name or requested_name,
                existing_slug=existing_slug,
                existing_storage_id=existing_storage_id,
                existing_folder_name=existing_folder_name,
                requested_storage_id=requested_storage_id,
                folder_name=folder_name,
                data=data,
                now=now,
            )
        return requested_name


__all__ = ["upsert_artist"]
