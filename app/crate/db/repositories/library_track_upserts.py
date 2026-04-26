from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryTrack
from crate.db.repositories.library_processing_state import ensure_track_processing_rows
from crate.db.repositories.library_shared import allocate_unique_slug, coerce_uuid
from crate.db.tx import optional_scope
from crate.slugs import build_track_slug


def upsert_track(data: dict, *, session: Session | None = None) -> None:
    with optional_scope(session) as s:
        now = datetime.now(timezone.utc)
        existing = s.execute(select(LibraryTrack.slug, LibraryTrack.storage_id).where(LibraryTrack.path == data["path"]).limit(1)).first()
        slug = (
            existing[0]
            if existing and existing[0]
            else allocate_unique_slug(s, LibraryTrack, build_track_slug(data["artist"], data.get("title"), data.get("filename")))
        )
        storage_id = existing[1] if existing and existing[1] else coerce_uuid(data.get("storage_id"))
        insert_stmt = pg_insert(LibraryTrack).values(
            storage_id=storage_id,
            album_id=data.get("album_id"),
            artist=data["artist"],
            album=data["album"],
            slug=slug,
            filename=data["filename"],
            title=data.get("title"),
            track_number=data.get("track_number"),
            disc_number=data.get("disc_number", 1),
            format=data.get("format"),
            bitrate=data.get("bitrate"),
            sample_rate=data.get("sample_rate"),
            bit_depth=data.get("bit_depth"),
            duration=data.get("duration"),
            size=data.get("size"),
            year=data.get("year"),
            genre=data.get("genre"),
            albumartist=data.get("albumartist"),
            musicbrainz_albumid=data.get("musicbrainz_albumid"),
            musicbrainz_trackid=data.get("musicbrainz_trackid"),
            path=data["path"],
            updated_at=now,
        )
        s.execute(
            insert_stmt.on_conflict_do_update(
                index_elements=[LibraryTrack.path],
                set_={
                    "storage_id": func.coalesce(LibraryTrack.storage_id, insert_stmt.excluded.storage_id),
                    "album_id": insert_stmt.excluded.album_id,
                    "artist": insert_stmt.excluded.artist,
                    "album": insert_stmt.excluded.album,
                    "slug": func.coalesce(LibraryTrack.slug, insert_stmt.excluded.slug),
                    "filename": insert_stmt.excluded.filename,
                    "title": insert_stmt.excluded.title,
                    "track_number": insert_stmt.excluded.track_number,
                    "disc_number": insert_stmt.excluded.disc_number,
                    "format": insert_stmt.excluded.format,
                    "bitrate": insert_stmt.excluded.bitrate,
                    "sample_rate": insert_stmt.excluded.sample_rate,
                    "bit_depth": insert_stmt.excluded.bit_depth,
                    "duration": insert_stmt.excluded.duration,
                    "size": insert_stmt.excluded.size,
                    "year": insert_stmt.excluded.year,
                    "genre": insert_stmt.excluded.genre,
                    "albumartist": insert_stmt.excluded.albumartist,
                    "musicbrainz_albumid": func.coalesce(
                        func.nullif(insert_stmt.excluded.musicbrainz_albumid, ""),
                        LibraryTrack.musicbrainz_albumid,
                    ),
                    "musicbrainz_trackid": func.coalesce(
                        func.nullif(insert_stmt.excluded.musicbrainz_trackid, ""),
                        LibraryTrack.musicbrainz_trackid,
                    ),
                    "updated_at": insert_stmt.excluded.updated_at,
                },
            )
        )

        track_id = int(s.execute(select(LibraryTrack.id).where(LibraryTrack.path == data["path"]).limit(1)).scalar_one())
        ensure_track_processing_rows(s, track_id)


__all__ = ["upsert_track"]
