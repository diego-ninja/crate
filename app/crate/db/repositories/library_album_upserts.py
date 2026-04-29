from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import false, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from crate.entity_ids import album_entity_uid
from crate.db.orm.library import LibraryAlbum
from crate.db.orm.library import LibraryArtist
from crate.db.repositories.entity_identity_keys import upsert_entity_identity_key
from crate.db.repositories.library_shared import allocate_unique_slug, coerce_uuid_or_none
from crate.db.tx import optional_scope
from crate.slugs import build_album_slug


def upsert_album(data: dict, *, session: Session | None = None) -> int:
    with optional_scope(session) as s:
        now = datetime.now(timezone.utc)
        requested_entity_uid = coerce_uuid_or_none(data.get("entity_uid"))
        path_match = LibraryAlbum.path == data["path"]
        entity_match = LibraryAlbum.entity_uid == requested_entity_uid if requested_entity_uid is not None else false()
        requested_mbid = (data.get("musicbrainz_albumid") or "").strip()
        requested_rgid = (data.get("musicbrainz_releasegroupid") or "").strip()
        existing = s.execute(
            select(
                LibraryAlbum.id,
                LibraryAlbum.slug,
                LibraryAlbum.storage_id,
                LibraryAlbum.entity_uid,
                LibraryAlbum.musicbrainz_albumid,
                LibraryAlbum.musicbrainz_releasegroupid,
                LibraryAlbum.tag_album,
            )
            .where(
                or_(
                    path_match,
                    entity_match,
                    LibraryAlbum.musicbrainz_albumid == requested_mbid if requested_mbid else false(),
                    LibraryAlbum.musicbrainz_releasegroupid == requested_rgid if requested_rgid else false(),
                )
            )
            .limit(1)
        ).first()
        slug = existing[1] if existing and existing[1] else allocate_unique_slug(s, LibraryAlbum, build_album_slug(data["artist"], data["name"]))
        requested_storage_id = coerce_uuid_or_none(data.get("storage_id"))
        artist_entity_uid = s.execute(
            select(LibraryArtist.entity_uid).where(LibraryArtist.name == data["artist"]).limit(1)
        ).scalar_one_or_none()
        requested_tag_album = data.get("tag_album")
        entity_uid = (
            existing[3]
            if existing and existing[3]
            else requested_entity_uid or album_entity_uid(
                artist_name=data["artist"],
                artist_uid=artist_entity_uid,
                album_name=data["name"],
                year=data.get("year"),
                musicbrainz_albumid=data.get("musicbrainz_albumid"),
                musicbrainz_releasegroupid=data.get("musicbrainz_releasegroupid"),
                tag_album=data.get("tag_album"),
            )
        )
        storage_id = existing[2] if existing and existing[2] else requested_storage_id
        if existing:
            album_id = int(existing[0])
            existing_album_mbid = existing[4]
            existing_releasegroupid = existing[5]
            existing_tag_album = existing[6]
            s.execute(
                update(LibraryAlbum)
                .where(LibraryAlbum.id == album_id)
                .values(
                    storage_id=storage_id,
                    entity_uid=entity_uid,
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
                    musicbrainz_albumid=requested_mbid or existing_album_mbid,
                    musicbrainz_releasegroupid=requested_rgid or existing_releasegroupid,
                    tag_album=requested_tag_album if requested_tag_album is not None else existing_tag_album,
                    dir_mtime=data.get("dir_mtime"),
                    updated_at=now,
                )
            )
            upsert_entity_identity_key(
                s,
                entity_type="album",
                entity_uid=entity_uid,
                key_type="scoped_name",
                key_value=f"{data['artist']}::{data['name']}",
                is_primary=True,
            )
            upsert_entity_identity_key(s, entity_type="album", entity_uid=entity_uid, key_type="slug", key_value=slug, is_primary=True)
            if requested_mbid:
                upsert_entity_identity_key(s, entity_type="album", entity_uid=entity_uid, key_type="musicbrainz_albumid", key_value=requested_mbid)
            if requested_rgid:
                upsert_entity_identity_key(s, entity_type="album", entity_uid=entity_uid, key_type="musicbrainz_releasegroupid", key_value=requested_rgid)
            return album_id
        insert_stmt = pg_insert(LibraryAlbum).values(
            storage_id=storage_id,
            entity_uid=entity_uid,
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
                    "entity_uid": func.coalesce(LibraryAlbum.entity_uid, insert_stmt.excluded.entity_uid),
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
        upsert_entity_identity_key(
            s,
            entity_type="album",
            entity_uid=entity_uid,
            key_type="scoped_name",
            key_value=f"{data['artist']}::{data['name']}",
            is_primary=True,
        )
        upsert_entity_identity_key(s, entity_type="album", entity_uid=entity_uid, key_type="slug", key_value=slug, is_primary=True)
        if requested_mbid:
            upsert_entity_identity_key(s, entity_type="album", entity_uid=entity_uid, key_type="musicbrainz_albumid", key_value=requested_mbid)
        if requested_rgid:
            upsert_entity_identity_key(s, entity_type="album", entity_uid=entity_uid, key_type="musicbrainz_releasegroupid", key_value=requested_rgid)
        row = s.execute(select(LibraryAlbum.id).where(LibraryAlbum.path == data["path"]).limit(1)).scalar_one()
        return int(row)


__all__ = ["upsert_album"]
