from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import case, false, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from crate.entity_ids import artist_entity_uid
from crate.db.repositories.entity_identity_keys import upsert_entity_identity_key
from crate.db.orm.library import LibraryArtist
from crate.db.repositories.library_shared import allocate_unique_slug, coerce_uuid_or_none
from crate.db.tx import optional_scope
from crate.slugs import build_artist_slug


def _select_existing_artist(
    session: Session,
    *,
    requested_name: str,
    folder_name: str,
    requested_storage_id,
    requested_entity_uid,
    requested_mbid: str | None,
):
    storage_match = LibraryArtist.storage_id == requested_storage_id if requested_storage_id is not None else false()
    entity_match = LibraryArtist.entity_uid == requested_entity_uid if requested_entity_uid is not None else false()
    folder_match = LibraryArtist.folder_name == folder_name if folder_name else false()
    name_match = func.lower(LibraryArtist.name) == func.lower(requested_name)
    mbid_match = func.lower(LibraryArtist.mbid) == func.lower(requested_mbid) if requested_mbid else false()
    identity_match = or_(mbid_match, name_match, folder_match, storage_match, entity_match)
    priority = case(
        (mbid_match, 0),
        (entity_match, 1),
        (storage_match, 2),
        (folder_match, 3),
        (name_match, 4),
        else_=5,
    )
    return session.execute(
        select(
            LibraryArtist.id,
            LibraryArtist.name,
            LibraryArtist.slug,
            LibraryArtist.storage_id,
            LibraryArtist.entity_uid,
            LibraryArtist.folder_name,
            LibraryArtist.mbid,
            LibraryArtist.spotify_id,
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
    existing_entity_uid,
    existing_folder_name: str | None,
    existing_mbid: str | None,
    existing_spotify_id: str | None,
    requested_storage_id,
    folder_name: str,
    data: dict,
    now: datetime,
) -> str:
    slug = existing_slug or allocate_unique_slug(session, LibraryArtist, build_artist_slug(canonical_name))
    requested_entity_uid = coerce_uuid_or_none(data.get("entity_uid"))
    entity_uid = existing_entity_uid or requested_entity_uid or artist_entity_uid(name=canonical_name, mbid=data.get("mbid"))
    session.execute(
        update(LibraryArtist)
        .where(LibraryArtist.id == artist_id)
        .values(
            storage_id=existing_storage_id or requested_storage_id,
            entity_uid=entity_uid,
            slug=slug,
            folder_name=existing_folder_name or folder_name,
            album_count=data.get("album_count", 0),
            track_count=data.get("track_count", 0),
            total_size=data.get("total_size", 0),
            formats_json=list(data.get("formats", [])),
            primary_format=data.get("primary_format"),
            has_photo=data.get("has_photo", 0),
            dir_mtime=data.get("dir_mtime"),
            mbid=(data.get("mbid") or "").strip() or existing_mbid,
            spotify_id=(data.get("spotify_id") or "").strip() or existing_spotify_id,
            updated_at=now,
        )
    )
    upsert_entity_identity_key(session, entity_type="artist", entity_uid=entity_uid, key_type="name", key_value=canonical_name, is_primary=True)
    upsert_entity_identity_key(session, entity_type="artist", entity_uid=entity_uid, key_type="slug", key_value=slug, is_primary=True)
    if data.get("mbid"):
        upsert_entity_identity_key(session, entity_type="artist", entity_uid=entity_uid, key_type="mbid", key_value=data.get("mbid"))
    if data.get("spotify_id"):
        upsert_entity_identity_key(session, entity_type="artist", entity_uid=entity_uid, key_type="spotify_id", key_value=data.get("spotify_id"))
    return canonical_name


def upsert_artist(data: dict, *, session: Session | None = None) -> str:
    with optional_scope(session) as s:
        now = datetime.now(timezone.utc)
        requested_name = str(data["name"]).strip()
        folder_name = str(data.get("folder_name") or requested_name).strip()
        requested_storage_id = coerce_uuid_or_none(data.get("storage_id"))
        requested_entity_uid = coerce_uuid_or_none(data.get("entity_uid"))
        requested_mbid = (data.get("mbid") or "").strip() or None
        existing = _select_existing_artist(
            s,
            requested_name=requested_name,
            folder_name=folder_name,
            requested_storage_id=requested_storage_id,
            requested_entity_uid=requested_entity_uid,
            requested_mbid=requested_mbid,
        )
        if existing:
            artist_id, canonical_name, existing_slug, existing_storage_id, existing_entity_uid, existing_folder_name, existing_mbid, existing_spotify_id = existing
            return _update_existing_artist(
                s,
                artist_id=int(artist_id),
                canonical_name=canonical_name or requested_name,
                existing_slug=existing_slug,
                existing_storage_id=existing_storage_id,
                existing_entity_uid=existing_entity_uid,
                existing_folder_name=existing_folder_name,
                existing_mbid=existing_mbid,
                existing_spotify_id=existing_spotify_id,
                requested_storage_id=requested_storage_id,
                folder_name=folder_name,
                data=data,
                now=now,
            )

        slug = allocate_unique_slug(s, LibraryArtist, build_artist_slug(requested_name))
        entity_uid = coerce_uuid_or_none(data.get("entity_uid")) or artist_entity_uid(name=requested_name, mbid=data.get("mbid"))
        insert_stmt = pg_insert(LibraryArtist).values(
            name=requested_name,
            storage_id=requested_storage_id,
            entity_uid=entity_uid,
            slug=slug,
            folder_name=folder_name,
            album_count=data.get("album_count", 0),
            track_count=data.get("track_count", 0),
            total_size=data.get("total_size", 0),
            formats_json=list(data.get("formats", [])),
            primary_format=data.get("primary_format"),
            has_photo=data.get("has_photo", 0),
            dir_mtime=data.get("dir_mtime"),
            mbid=(data.get("mbid") or "").strip() or None,
            spotify_id=(data.get("spotify_id") or "").strip() or None,
            updated_at=now,
        )
        try:
            with s.begin_nested():
                s.execute(insert_stmt)
                upsert_entity_identity_key(s, entity_type="artist", entity_uid=entity_uid, key_type="name", key_value=requested_name, is_primary=True)
                upsert_entity_identity_key(s, entity_type="artist", entity_uid=entity_uid, key_type="slug", key_value=slug, is_primary=True)
                if data.get("mbid"):
                    upsert_entity_identity_key(s, entity_type="artist", entity_uid=entity_uid, key_type="mbid", key_value=data.get("mbid"))
                if data.get("spotify_id"):
                    upsert_entity_identity_key(s, entity_type="artist", entity_uid=entity_uid, key_type="spotify_id", key_value=data.get("spotify_id"))
        except IntegrityError:
            existing = _select_existing_artist(
                s,
                requested_name=requested_name,
                folder_name=folder_name,
                requested_storage_id=requested_storage_id,
                requested_entity_uid=requested_entity_uid,
                requested_mbid=requested_mbid,
            )
            if not existing:
                raise
            artist_id, canonical_name, existing_slug, existing_storage_id, existing_entity_uid, existing_folder_name, existing_mbid, existing_spotify_id = existing
            return _update_existing_artist(
                s,
                artist_id=int(artist_id),
                canonical_name=canonical_name or requested_name,
                existing_slug=existing_slug,
                existing_storage_id=existing_storage_id,
                existing_entity_uid=existing_entity_uid,
                existing_folder_name=existing_folder_name,
                existing_mbid=existing_mbid,
                existing_spotify_id=existing_spotify_id,
                requested_storage_id=requested_storage_id,
                folder_name=folder_name,
                data=data,
                now=now,
            )
        return requested_name


__all__ = ["upsert_artist"]
