"""Enrichment/delete helpers for library repository writes."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryAlbum, LibraryArtist, LibraryTrack
from crate.db.tx import optional_scope


def update_artist_enrichment(name: str, data: dict, *, session: Session | None = None) -> None:
    def _impl(s: Session) -> None:
        artist = s.execute(select(LibraryArtist).where(LibraryArtist.name == name).limit(1)).scalar_one_or_none()
        if artist is None:
            return

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
        for attr, value in field_map.items():
            if value is not None:
                setattr(artist, attr, value)
        artist.enriched_at = datetime.now(timezone.utc)

    with optional_scope(session) as s:
        _impl(s)


def update_artist_has_photo(name: str, *, session: Session | None = None) -> None:
    def _impl(s: Session) -> None:
        artist = s.execute(select(LibraryArtist).where(LibraryArtist.name == name).limit(1)).scalar_one_or_none()
        if artist is not None:
            artist.has_photo = 1

    with optional_scope(session) as s:
        _impl(s)


def delete_artist(name: str, *, session: Session | None = None) -> None:
    def _impl(s: Session) -> None:
        album_ids = s.execute(select(LibraryAlbum.id).where(LibraryAlbum.artist == name)).scalars().all()
        if album_ids:
            s.execute(delete(LibraryTrack).where(LibraryTrack.album_id.in_(album_ids)))
        s.execute(delete(LibraryAlbum).where(LibraryAlbum.artist == name))
        s.execute(delete(LibraryArtist).where(LibraryArtist.name == name))

    with optional_scope(session) as s:
        _impl(s)


def delete_album(path: str, *, session: Session | None = None) -> None:
    def _impl(s: Session) -> None:
        album_id = s.execute(select(LibraryAlbum.id).where(LibraryAlbum.path == path).limit(1)).scalar_one_or_none()
        if album_id is not None:
            s.execute(delete(LibraryTrack).where(LibraryTrack.album_id == album_id))
            s.execute(delete(LibraryAlbum).where(LibraryAlbum.id == album_id))

    with optional_scope(session) as s:
        _impl(s)


def delete_track(path: str, *, session: Session | None = None) -> None:
    def _impl(s: Session) -> None:
        s.execute(delete(LibraryTrack).where(LibraryTrack.path == path))

    with optional_scope(session) as s:
        _impl(s)


def set_track_rating(track_id: int, rating: int, *, session: Session | None = None) -> None:
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
    "update_artist_enrichment",
    "update_artist_has_photo",
]
