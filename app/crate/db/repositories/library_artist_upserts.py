from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import false, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryArtist
from crate.db.repositories.library_shared import allocate_unique_slug, coerce_uuid
from crate.db.tx import optional_scope
from crate.slugs import build_artist_slug


def upsert_artist(data: dict, *, session: Session | None = None) -> str:
    with optional_scope(session) as s:
        now = datetime.now(timezone.utc)
        requested_name = str(data["name"]).strip()
        folder_name = str(data.get("folder_name") or requested_name).strip()
        requested_storage_id = coerce_uuid(data.get("storage_id"))
        storage_match = LibraryArtist.storage_id == requested_storage_id if requested_storage_id is not None else false()
        existing = s.execute(
            select(LibraryArtist.name, LibraryArtist.slug, LibraryArtist.storage_id).where(
                or_(
                    func.lower(LibraryArtist.name) == func.lower(requested_name),
                    LibraryArtist.folder_name == folder_name,
                    storage_match,
                )
            ).limit(1)
        ).first()
        canonical_name = existing[0] if existing and existing[0] else requested_name
        slug = existing[1] if existing and existing[1] else allocate_unique_slug(s, LibraryArtist, build_artist_slug(canonical_name))
        storage_id = existing[2] if existing and existing[2] else requested_storage_id
        insert_stmt = pg_insert(LibraryArtist).values(
            name=canonical_name,
            storage_id=storage_id,
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
        s.execute(
            insert_stmt.on_conflict_do_update(
                index_elements=[LibraryArtist.name],
                set_={
                    "storage_id": func.coalesce(LibraryArtist.storage_id, insert_stmt.excluded.storage_id),
                    "slug": func.coalesce(LibraryArtist.slug, insert_stmt.excluded.slug),
                    "folder_name": func.coalesce(LibraryArtist.folder_name, insert_stmt.excluded.folder_name),
                    "album_count": insert_stmt.excluded.album_count,
                    "track_count": insert_stmt.excluded.track_count,
                    "total_size": insert_stmt.excluded.total_size,
                    "formats_json": insert_stmt.excluded.formats_json,
                    "primary_format": insert_stmt.excluded.primary_format,
                    "has_photo": insert_stmt.excluded.has_photo,
                    "dir_mtime": insert_stmt.excluded.dir_mtime,
                    "updated_at": insert_stmt.excluded.updated_at,
                },
            )
        )
        return canonical_name


__all__ = ["upsert_artist"]
