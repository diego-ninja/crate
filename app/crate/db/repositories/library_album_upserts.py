from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryAlbum
from crate.db.repositories.library_shared import allocate_unique_slug, coerce_uuid
from crate.db.tx import optional_scope
from crate.slugs import build_album_slug


def upsert_album(data: dict, *, session: Session | None = None) -> int:
    with optional_scope(session) as s:
        now = datetime.now(timezone.utc)
        existing = s.execute(select(LibraryAlbum.slug, LibraryAlbum.storage_id).where(LibraryAlbum.path == data["path"]).limit(1)).first()
        slug = existing[0] if existing and existing[0] else allocate_unique_slug(s, LibraryAlbum, build_album_slug(data["artist"], data["name"]))
        storage_id = existing[1] if existing and existing[1] else coerce_uuid(data.get("storage_id"))
        insert_stmt = pg_insert(LibraryAlbum).values(
            storage_id=storage_id,
            artist=data["artist"],
            name=data["name"],
            slug=slug,
            path=data["path"],
            track_count=data.get("track_count", 0),
            total_size=data.get("total_size", 0),
            total_duration=data.get("total_duration", 0),
            formats_json=list(data.get("formats", [])),
            year=data.get("year"),
            genre=data.get("genre"),
            has_cover=data.get("has_cover", 0),
            musicbrainz_albumid=data.get("musicbrainz_albumid"),
            tag_album=data.get("tag_album"),
            dir_mtime=data.get("dir_mtime"),
            updated_at=now,
        )
        s.execute(
            insert_stmt.on_conflict_do_update(
                index_elements=[LibraryAlbum.path],
                set_={
                    "storage_id": func.coalesce(LibraryAlbum.storage_id, insert_stmt.excluded.storage_id),
                    "artist": insert_stmt.excluded.artist,
                    "name": insert_stmt.excluded.name,
                    "slug": func.coalesce(LibraryAlbum.slug, insert_stmt.excluded.slug),
                    "track_count": insert_stmt.excluded.track_count,
                    "total_size": insert_stmt.excluded.total_size,
                    "total_duration": insert_stmt.excluded.total_duration,
                    "formats_json": insert_stmt.excluded.formats_json,
                    "year": insert_stmt.excluded.year,
                    "genre": insert_stmt.excluded.genre,
                    "has_cover": insert_stmt.excluded.has_cover,
                    "musicbrainz_albumid": func.coalesce(
                        func.nullif(insert_stmt.excluded.musicbrainz_albumid, ""),
                        LibraryAlbum.musicbrainz_albumid,
                    ),
                    "tag_album": func.coalesce(insert_stmt.excluded.tag_album, LibraryAlbum.tag_album),
                    "dir_mtime": insert_stmt.excluded.dir_mtime,
                    "updated_at": insert_stmt.excluded.updated_at,
                },
            )
        )
        row = s.execute(select(LibraryAlbum.id).where(LibraryAlbum.path == data["path"]).limit(1)).scalar_one()
        return int(row)


__all__ = ["upsert_album"]
