from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryArtist
from crate.db.repositories.library_shared import allocate_unique_slug, coerce_uuid
from crate.db.tx import optional_scope
from crate.slugs import build_artist_slug


def upsert_artist(data: dict, *, session: Session | None = None) -> None:
    with optional_scope(session) as s:
        now = datetime.now(timezone.utc)
        existing = s.execute(select(LibraryArtist.slug, LibraryArtist.storage_id).where(LibraryArtist.name == data["name"]).limit(1)).first()
        slug = existing[0] if existing and existing[0] else allocate_unique_slug(s, LibraryArtist, build_artist_slug(data["name"]))
        storage_id = existing[1] if existing and existing[1] else coerce_uuid(data.get("storage_id"))
        insert_stmt = pg_insert(LibraryArtist).values(
            name=data["name"],
            storage_id=storage_id,
            slug=slug,
            folder_name=data.get("folder_name") or data["name"],
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


__all__ = ["upsert_artist"]
