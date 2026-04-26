"""Shared helpers for library repository modules."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session


def coerce_uuid(value: str | uuid.UUID | None) -> uuid.UUID:
    if isinstance(value, uuid.UUID):
        return value
    if value:
        return uuid.UUID(str(value))
    return uuid.uuid4()


def artist_to_dict(artist) -> dict | None:
    if artist is None:
        return None
    return {
        "id": artist.id,
        "storage_id": str(artist.storage_id) if artist.storage_id else None,
        "name": artist.name,
        "slug": artist.slug,
        "folder_name": artist.folder_name,
        "album_count": artist.album_count or 0,
        "track_count": artist.track_count or 0,
        "total_size": artist.total_size or 0,
        "formats": list(artist.formats_json or []),
        "primary_format": artist.primary_format,
        "has_photo": artist.has_photo or 0,
        "dir_mtime": artist.dir_mtime,
        "updated_at": artist.updated_at,
        "bio": artist.bio,
        "tags_json": artist.tags_json,
        "similar_json": artist.similar_json,
        "spotify_id": artist.spotify_id,
        "spotify_popularity": artist.spotify_popularity,
        "spotify_followers": artist.spotify_followers,
        "mbid": artist.mbid,
        "country": artist.country,
        "area": artist.area,
        "formed": artist.formed,
        "ended": artist.ended,
        "artist_type": artist.artist_type,
        "members_json": artist.members_json,
        "urls_json": artist.urls_json,
        "listeners": artist.listeners,
        "enriched_at": artist.enriched_at,
        "discogs_id": artist.discogs_id,
        "lastfm_playcount": artist.lastfm_playcount,
        "popularity": artist.popularity,
        "popularity_score": artist.popularity_score,
        "popularity_confidence": artist.popularity_confidence,
        "discogs_profile": artist.discogs_profile,
        "discogs_members_json": artist.discogs_members_json,
        "latest_release_date": artist.latest_release_date,
        "content_hash": artist.content_hash,
    }


def album_to_dict(album) -> dict | None:
    if album is None:
        return None
    return {
        "id": album.id,
        "storage_id": str(album.storage_id) if album.storage_id else None,
        "artist": album.artist,
        "name": album.name,
        "slug": album.slug,
        "path": album.path,
        "track_count": album.track_count or 0,
        "total_size": album.total_size or 0,
        "total_duration": album.total_duration or 0,
        "formats": list(album.formats_json or []),
        "year": album.year,
        "genre": album.genre,
        "has_cover": album.has_cover or 0,
        "musicbrainz_albumid": album.musicbrainz_albumid,
        "musicbrainz_releasegroupid": album.musicbrainz_releasegroupid,
        "tag_album": album.tag_album,
        "dir_mtime": album.dir_mtime,
        "updated_at": album.updated_at,
        "discogs_master_id": album.discogs_master_id,
        "lastfm_listeners": album.lastfm_listeners,
        "lastfm_playcount": album.lastfm_playcount,
        "popularity": album.popularity,
        "popularity_score": album.popularity_score,
        "popularity_confidence": album.popularity_confidence,
        "quarantined_at": album.quarantined_at,
        "quarantine_task_id": album.quarantine_task_id,
    }


def track_to_dict(track) -> dict | None:
    if track is None:
        return None
    return {
        "id": track.id,
        "storage_id": str(track.storage_id) if track.storage_id else None,
        "album_id": track.album_id,
        "artist": track.artist,
        "album": track.album,
        "slug": track.slug,
        "filename": track.filename,
        "title": track.title,
        "track_number": track.track_number,
        "disc_number": track.disc_number or 1,
        "format": track.format,
        "bitrate": track.bitrate,
        "sample_rate": track.sample_rate,
        "bit_depth": track.bit_depth,
        "duration": track.duration,
        "size": track.size,
        "year": track.year,
        "genre": track.genre,
        "albumartist": track.albumartist,
        "musicbrainz_albumid": track.musicbrainz_albumid,
        "musicbrainz_trackid": track.musicbrainz_trackid,
        "path": track.path,
        "updated_at": track.updated_at,
        "bpm": track.bpm,
        "audio_key": track.audio_key,
        "audio_scale": track.audio_scale,
        "energy": track.energy,
        "mood_json": track.mood_json,
        "danceability": track.danceability,
        "valence": track.valence,
        "acousticness": track.acousticness,
        "instrumentalness": track.instrumentalness,
        "loudness": track.loudness,
        "dynamic_range": track.dynamic_range,
        "spectral_complexity": track.spectral_complexity,
        "analysis_state": track.analysis_state,
        "bliss_state": track.bliss_state,
        "analysis_completed_at": track.analysis_completed_at,
        "bliss_computed_at": track.bliss_computed_at,
        "bliss_vector": list(track.bliss_vector or []) if track.bliss_vector is not None else None,
        "lastfm_listeners": track.lastfm_listeners,
        "lastfm_playcount": track.lastfm_playcount,
        "lastfm_top_rank": track.lastfm_top_rank,
        "spotify_track_popularity": track.spotify_track_popularity,
        "spotify_top_rank": track.spotify_top_rank,
        "popularity": track.popularity,
        "popularity_score": track.popularity_score,
        "popularity_confidence": track.popularity_confidence,
        "rating": track.rating or 0,
    }


def allocate_unique_slug(session: Session, model, base_slug: str) -> str:
    candidate = base_slug or "item"
    suffix = 2
    while True:
        exists = session.execute(select(model.id).where(model.slug == candidate).limit(1)).scalar_one_or_none()
        if exists is None:
            return candidate
        candidate = f"{base_slug}-{suffix}"
        suffix += 1


__all__ = [
    "album_to_dict",
    "allocate_unique_slug",
    "artist_to_dict",
    "coerce_uuid",
    "track_to_dict",
]
