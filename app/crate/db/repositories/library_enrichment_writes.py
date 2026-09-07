"""Enrichment/delete helpers for library repository writes."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryAlbum, LibraryArtist, LibraryTrack
from crate.db.repositories.field_locks import list_locked_fields, lock_fields
from crate.db.repositories.genres import set_artist_taxonomy_genres
from crate.db.repositories.global_catalog_dirty_sources import (
    enqueue_local_dirty_source,
)
from crate.db.repositories.library_shared import coerce_uuid_or_none
from crate.db.tx import optional_scope


ARTIST_METADATA_FIELDS = {
    "bio": "bio",
    "tags": "tags_json",
    "urls": "urls_json",
    "mbid": "mbid",
    "country": "country",
    "area": "area",
    "formed": "formed",
    "ended": "ended",
    "artist_type": "artist_type",
    "bandcamp_url": "bandcamp_url",
}


def _artist_metadata_snapshot(artist: LibraryArtist) -> dict[str, Any]:
    return {
        "bio": artist.bio,
        "tags": artist.tags_json if isinstance(artist.tags_json, list) else [],
        "urls": artist.urls_json if isinstance(artist.urls_json, dict) else {},
        "mbid": artist.mbid,
        "country": artist.country,
        "area": artist.area,
        "formed": artist.formed,
        "ended": artist.ended,
        "artist_type": artist.artist_type,
        "bandcamp_url": artist.bandcamp_url,
    }


def _manual_artist_genres(session: Session, artist_name: str) -> list[str]:
    rows = (
        session.execute(
            text(
                """
            SELECT COALESCE(tn.slug, g.slug) AS slug
            FROM artist_genres ag
            JOIN genres g ON g.id = ag.genre_id
            LEFT JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
            LEFT JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
            WHERE ag.artist_name = :artist_name AND ag.source = 'manual'
            ORDER BY COALESCE(tn.slug, g.slug)
            """
            ),
            {"artist_name": artist_name},
        )
        .mappings()
        .all()
    )
    return [str(row["slug"]) for row in rows if row.get("slug")]


def _required_artist_id(artist: LibraryArtist) -> int:
    if artist.id is None:
        raise RuntimeError(f"Library artist {artist.name!r} is missing numeric id")
    return artist.id


def update_artist_metadata(
    *,
    artist_id: int | None = None,
    artist_entity_uid: str | None = None,
    artist_name: str | None = None,
    metadata: dict[str, Any],
    locked_by_user_id: int | None = None,
    session: Session | None = None,
) -> dict[str, Any] | None:
    values = {
        key: value for key, value in metadata.items() if key in ARTIST_METADATA_FIELDS
    }
    has_genres = "genres" in metadata
    if not values and not has_genres:
        return None

    def _impl(s: Session) -> dict[str, Any] | None:
        predicates = []
        if artist_id is not None:
            predicates.append(LibraryArtist.id == int(artist_id))
        if artist_entity_uid:
            entity_uid = coerce_uuid_or_none(artist_entity_uid)
            if entity_uid is not None:
                predicates.append(LibraryArtist.entity_uid == entity_uid)
        if artist_name:
            predicates.append(func.lower(LibraryArtist.name) == func.lower(artist_name))
        if not predicates:
            return None

        artist = s.execute(
            select(LibraryArtist).where(or_(*predicates)).limit(1)
        ).scalar_one_or_none()
        if artist is None:
            return None
        numeric_artist_id = _required_artist_id(artist)

        before = _artist_metadata_snapshot(artist)
        before["genres"] = _manual_artist_genres(s, artist.name)
        for key, value in values.items():
            setattr(artist, ARTIST_METADATA_FIELDS[key], value)
            if key == "bandcamp_url":
                artist.bandcamp_url_source = "manual" if value else None
                artist.bandcamp_url_updated_at = datetime.now(timezone.utc)
        if has_genres:
            raw_genres = metadata.get("genres")
            if not isinstance(raw_genres, list):
                raise ValueError("genres must be a list of taxonomy slugs")
            set_artist_taxonomy_genres(
                artist.name,
                [str(slug) for slug in raw_genres],
                session=s,
            )

        after = _artist_metadata_snapshot(artist)
        after["genres"] = _manual_artist_genres(s, artist.name)
        changed_fields = [key for key in values if before.get(key) != after.get(key)]
        if has_genres and before.get("genres") != after.get("genres"):
            changed_fields.append("genres")
        if changed_fields:
            artist.updated_at = datetime.now(timezone.utc)
            lock_fields(
                entity_type="artist",
                entity_id=numeric_artist_id,
                field_names=changed_fields,
                locked_by_user_id=locked_by_user_id,
                reason="Manual artist metadata edit",
                source="manual_edit",
                session=s,
            )

        return {
            "artist_id": artist.id,
            "artist_entity_uid": str(artist.entity_uid)
            if artist.entity_uid is not None
            else None,
            "artist_name": artist.name,
            "before": {key: before.get(key) for key in changed_fields},
            "after": {key: after.get(key) for key in changed_fields},
            "changed_fields": changed_fields,
        }

    with optional_scope(session) as s:
        return _impl(s)


def update_artist_enrichment(
    name: str, data: dict, *, session: Session | None = None
) -> None:
    def _impl(s: Session) -> None:
        artist = s.execute(
            select(LibraryArtist).where(LibraryArtist.name == name).limit(1)
        ).scalar_one_or_none()
        if artist is None:
            return
        numeric_artist_id = _required_artist_id(artist)

        locked_fields = list_locked_fields(
            entity_type="artist",
            entity_id=numeric_artist_id,
            session=s,
        )
        field_map = {
            "bio": data.get("bio"),
            "tags_json": data.get("tags"),
            "similar_json": data.get("similar"),
            "spotify_id": data.get("spotify_id"),
            "spotify_popularity": data.get("spotify_popularity"),
            "spotify_followers": data.get("spotify_followers"),
            "mbid": data.get("mbid"),
            "country": data.get("country"),
            "area": data.get("area"),
            "formed": data.get("formed"),
            "ended": data.get("ended"),
            "artist_type": data.get("artist_type"),
            "members_json": data.get("members"),
            "urls_json": data.get("urls"),
            "listeners": data.get("listeners"),
            "lastfm_playcount": data.get("lastfm_playcount"),
            "discogs_id": data.get("discogs_id"),
            "discogs_profile": data.get("discogs_profile"),
            "discogs_members_json": data.get("discogs_members"),
        }
        field_lock_map = {
            "bio": "bio",
            "tags_json": "tags",
            "mbid": "mbid",
            "country": "country",
            "area": "area",
            "formed": "formed",
            "ended": "ended",
            "artist_type": "artist_type",
            "urls_json": "urls",
        }
        for attr, value in field_map.items():
            locked_field = field_lock_map.get(attr)
            if value is not None and locked_field not in locked_fields:
                setattr(artist, attr, value)
        artist.enriched_at = datetime.now(timezone.utc)

    with optional_scope(session) as s:
        _impl(s)


def update_artist_has_photo(name: str, *, session: Session | None = None) -> None:
    def _impl(s: Session) -> None:
        artist = s.execute(
            select(LibraryArtist).where(LibraryArtist.name == name).limit(1)
        ).scalar_one_or_none()
        if artist is not None:
            artist.has_photo = 1

    with optional_scope(session) as s:
        _impl(s)


def delete_artist(name: str, *, session: Session | None = None) -> None:
    def _impl(s: Session) -> None:
        artist_entity_uid = s.execute(
            select(LibraryArtist.entity_uid).where(LibraryArtist.name == name).limit(1)
        ).scalar_one_or_none()
        albums = s.execute(
            select(LibraryAlbum.id, LibraryAlbum.entity_uid).where(
                LibraryAlbum.artist == name
            )
        ).all()
        album_ids = [int(album_id) for album_id, _entity_uid in albums]
        if album_ids:
            track_entity_uids = (
                s.execute(
                    select(LibraryTrack.entity_uid).where(
                        LibraryTrack.album_id.in_(album_ids)
                    )
                )
                .scalars()
                .all()
            )
            for entity_uid in track_entity_uids:
                if entity_uid is not None:
                    enqueue_local_dirty_source(
                        "track", str(entity_uid), "delete", session=s
                    )
            for _album_id, entity_uid in albums:
                if entity_uid is not None:
                    enqueue_local_dirty_source(
                        "album", str(entity_uid), "delete", session=s
                    )
            s.execute(delete(LibraryTrack).where(LibraryTrack.album_id.in_(album_ids)))
        if artist_entity_uid is not None:
            enqueue_local_dirty_source(
                "artist", str(artist_entity_uid), "delete", session=s
            )
        s.execute(delete(LibraryAlbum).where(LibraryAlbum.artist == name))
        s.execute(delete(LibraryArtist).where(LibraryArtist.name == name))

    with optional_scope(session) as s:
        _impl(s)


def delete_album(path: str, *, session: Session | None = None) -> None:
    def _impl(s: Session) -> None:
        album = s.execute(
            select(LibraryAlbum.id, LibraryAlbum.entity_uid)
            .where(LibraryAlbum.path == path)
            .limit(1)
        ).first()
        if album is not None:
            album_id, album_entity_uid = album
            track_entity_uids = (
                s.execute(
                    select(LibraryTrack.entity_uid).where(
                        LibraryTrack.album_id == album_id
                    )
                )
                .scalars()
                .all()
            )
            for entity_uid in track_entity_uids:
                if entity_uid is not None:
                    enqueue_local_dirty_source(
                        "track", str(entity_uid), "delete", session=s
                    )
            if album_entity_uid is not None:
                enqueue_local_dirty_source(
                    "album", str(album_entity_uid), "delete", session=s
                )
            s.execute(delete(LibraryTrack).where(LibraryTrack.album_id == album_id))
            s.execute(delete(LibraryAlbum).where(LibraryAlbum.id == album_id))

    with optional_scope(session) as s:
        _impl(s)


def delete_track(path: str, *, session: Session | None = None) -> None:
    def _impl(s: Session) -> None:
        entity_uid = s.execute(
            select(LibraryTrack.entity_uid).where(LibraryTrack.path == path).limit(1)
        ).scalar_one_or_none()
        if entity_uid is not None:
            enqueue_local_dirty_source("track", str(entity_uid), "delete", session=s)
        s.execute(delete(LibraryTrack).where(LibraryTrack.path == path))

    with optional_scope(session) as s:
        _impl(s)


def set_track_rating(
    track_id: int, rating: int, *, session: Session | None = None
) -> None:
    def _impl(s: Session) -> None:
        track = s.get(LibraryTrack, track_id)
        if track is not None:
            track.rating = max(0, min(5, rating))

    with optional_scope(session) as s:
        _impl(s)


__all__ = [
    "delete_album",
    "delete_artist",
    "delete_track",
    "set_track_rating",
    "update_artist_metadata",
    "update_artist_enrichment",
    "update_artist_has_photo",
]
