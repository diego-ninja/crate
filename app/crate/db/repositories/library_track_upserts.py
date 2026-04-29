from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import false, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from crate.entity_ids import track_entity_uid
from crate.db.orm.library import LibraryAlbum
from crate.db.orm.library import LibraryTrack
from crate.db.repositories.entity_identity_keys import upsert_entity_identity_key
from crate.db.repositories.library_processing_state import ensure_track_processing_rows
from crate.db.repositories.library_shared import allocate_unique_slug, coerce_uuid_or_none
from crate.db.tx import optional_scope
from crate.slugs import build_track_slug


def upsert_track(data: dict, *, session: Session | None = None) -> None:
    with optional_scope(session) as s:
        now = datetime.now(timezone.utc)
        requested_entity_uid = coerce_uuid_or_none(data.get("entity_uid"))
        path_match = LibraryTrack.path == data["path"]
        entity_match = LibraryTrack.entity_uid == requested_entity_uid if requested_entity_uid is not None else false()
        requested_track_mbid = (data.get("musicbrainz_trackid") or "").strip()
        existing = s.execute(
            select(
                LibraryTrack.id,
                LibraryTrack.slug,
                LibraryTrack.storage_id,
                LibraryTrack.entity_uid,
                LibraryTrack.musicbrainz_albumid,
                LibraryTrack.musicbrainz_trackid,
                LibraryTrack.audio_fingerprint,
                LibraryTrack.audio_fingerprint_source,
                LibraryTrack.audio_fingerprint_computed_at,
            )
            .where(
                or_(
                    path_match,
                    entity_match,
                    LibraryTrack.musicbrainz_trackid == requested_track_mbid if requested_track_mbid else false(),
                )
            )
            .limit(1)
        ).first()
        slug = (
            existing[1]
            if existing and existing[1]
            else allocate_unique_slug(s, LibraryTrack, build_track_slug(data["artist"], data.get("title"), data.get("filename")))
        )
        album_entity_uid = None
        album_id = data.get("album_id")
        if album_id is not None:
            album_entity_uid = s.execute(
                select(LibraryAlbum.entity_uid).where(LibraryAlbum.id == album_id).limit(1)
            ).scalar_one_or_none()
        entity_uid = (
            existing[3]
            if existing and existing[3]
            else requested_entity_uid or track_entity_uid(
                album_uid=album_entity_uid,
                artist_name=data["artist"],
                album_name=data["album"],
                title=data.get("title"),
                filename=data.get("filename"),
                disc_number=data.get("disc_number"),
                track_number=data.get("track_number"),
                musicbrainz_trackid=data.get("musicbrainz_trackid"),
                musicbrainz_albumid=data.get("musicbrainz_albumid"),
            )
        )
        requested_storage_id = coerce_uuid_or_none(data.get("storage_id"))
        storage_id = existing[2] if existing and existing[2] else requested_storage_id
        requested_album_mbid = (data.get("musicbrainz_albumid") or "").strip()
        if existing:
            track_id = int(existing[0])
            existing_album_mbid = existing[4]
            existing_track_mbid = existing[5]
            existing_audio_fingerprint = existing[6]
            existing_audio_fingerprint_source = existing[7]
            existing_audio_fingerprint_computed_at = existing[8]
            s.execute(
                update(LibraryTrack)
                .where(LibraryTrack.id == track_id)
                .values(
                    storage_id=storage_id,
                    entity_uid=entity_uid,
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
                    musicbrainz_albumid=requested_album_mbid or existing_album_mbid,
                    musicbrainz_trackid=requested_track_mbid or existing_track_mbid,
                    audio_fingerprint=data.get("audio_fingerprint") or existing_audio_fingerprint,
                    audio_fingerprint_source=data.get("audio_fingerprint_source") or existing_audio_fingerprint_source,
                    audio_fingerprint_computed_at=now if data.get("audio_fingerprint") else existing_audio_fingerprint_computed_at,
                    path=data["path"],
                    updated_at=now,
                )
            )
            scoped_key = f"{data['album']}::{data.get('disc_number', 1)}::{data.get('track_number', 0)}::{data.get('title') or data.get('filename')}"
            upsert_entity_identity_key(s, entity_type="track", entity_uid=entity_uid, key_type="scoped_track", key_value=scoped_key, is_primary=True)
            upsert_entity_identity_key(s, entity_type="track", entity_uid=entity_uid, key_type="slug", key_value=slug, is_primary=True)
            if requested_track_mbid:
                upsert_entity_identity_key(s, entity_type="track", entity_uid=entity_uid, key_type="musicbrainz_trackid", key_value=requested_track_mbid)
            ensure_track_processing_rows(s, track_id)
            return
        insert_stmt = pg_insert(LibraryTrack).values(
            storage_id=storage_id,
            entity_uid=entity_uid,
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
            audio_fingerprint=data.get("audio_fingerprint"),
            audio_fingerprint_source=data.get("audio_fingerprint_source"),
            audio_fingerprint_computed_at=now if data.get("audio_fingerprint") else None,
            path=data["path"],
            updated_at=now,
        )
        s.execute(
            insert_stmt.on_conflict_do_update(
                index_elements=[LibraryTrack.path],
                set_={
                    "storage_id": func.coalesce(LibraryTrack.storage_id, insert_stmt.excluded.storage_id),
                    "entity_uid": func.coalesce(LibraryTrack.entity_uid, insert_stmt.excluded.entity_uid),
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
                    "audio_fingerprint": func.coalesce(insert_stmt.excluded.audio_fingerprint, LibraryTrack.audio_fingerprint),
                    "audio_fingerprint_source": func.coalesce(insert_stmt.excluded.audio_fingerprint_source, LibraryTrack.audio_fingerprint_source),
                    "audio_fingerprint_computed_at": func.coalesce(
                        insert_stmt.excluded.audio_fingerprint_computed_at,
                        LibraryTrack.audio_fingerprint_computed_at,
                    ),
                    "updated_at": insert_stmt.excluded.updated_at,
                },
            )
        )

        track_id = int(s.execute(select(LibraryTrack.id).where(LibraryTrack.path == data["path"]).limit(1)).scalar_one())
        scoped_key = f"{data['album']}::{data.get('disc_number', 1)}::{data.get('track_number', 0)}::{data.get('title') or data.get('filename')}"
        upsert_entity_identity_key(s, entity_type="track", entity_uid=entity_uid, key_type="scoped_track", key_value=scoped_key, is_primary=True)
        upsert_entity_identity_key(s, entity_type="track", entity_uid=entity_uid, key_type="slug", key_value=slug, is_primary=True)
        if requested_track_mbid:
            upsert_entity_identity_key(s, entity_type="track", entity_uid=entity_uid, key_type="musicbrainz_trackid", key_value=requested_track_mbid)
        ensure_track_processing_rows(s, track_id)


__all__ = ["upsert_track"]
