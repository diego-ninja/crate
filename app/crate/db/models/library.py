"""Typed models for the core library data layer.

Covers ``library_artists``, ``library_albums``, and ``library_tracks`` tables.
Field names match the dict keys produced by the ``_row_to_lib_*`` helpers
in ``db/library.py`` (e.g. ``formats`` instead of ``formats_json``).
"""


from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class ArtistRow(BaseModel):
    """Full library artist record.

    Returned by ``get_library_artist()``, ``get_library_artist_by_id()``, etc.
    The ``formats`` field is the deserialized ``formats_json`` column.
    """
    model_config = ConfigDict(from_attributes=True)

    id: int | None = None
    storage_id: str | None = None
    name: str
    slug: str | None = None
    folder_name: str | None = None
    album_count: int = 0
    track_count: int = 0
    total_size: int = 0
    formats: list[str] = []
    primary_format: str | None = None
    has_photo: int = 0
    dir_mtime: float | None = None
    updated_at: datetime | None = None

    # Enrichment fields
    bio: str | None = None
    tags_json: Any | None = None
    similar_json: Any | None = None
    spotify_id: str | None = None
    spotify_popularity: int | None = None
    spotify_followers: int | None = None
    mbid: str | None = None
    country: str | None = None
    area: str | None = None
    formed: str | None = None
    ended: str | None = None
    artist_type: str | None = None
    members_json: Any | None = None
    urls_json: Any | None = None
    listeners: int | None = None
    enriched_at: datetime | None = None
    discogs_id: str | None = None
    lastfm_playcount: int | None = None
    popularity: int | None = None
    popularity_score: float | None = None
    popularity_confidence: float | None = None
    discogs_profile: str | None = None
    discogs_members_json: Any | None = None
    latest_release_date: str | None = None
    content_hash: str | None = None


class AlbumRow(BaseModel):
    """Full library album record.

    Returned by ``get_library_album_by_id()``, ``get_library_album()``, etc.
    The ``formats`` field is the deserialized ``formats_json`` column.
    """
    model_config = ConfigDict(from_attributes=True)

    id: int
    storage_id: str | None = None
    artist: str
    name: str
    slug: str | None = None
    path: str
    track_count: int = 0
    total_size: int = 0
    total_duration: float = 0
    formats: list[str] = []
    year: str | None = None
    genre: str | None = None
    has_cover: int = 0
    musicbrainz_albumid: str | None = None
    musicbrainz_releasegroupid: str | None = None
    tag_album: str | None = None
    dir_mtime: float | None = None
    updated_at: datetime | None = None
    discogs_master_id: str | None = None
    lastfm_listeners: int | None = None
    lastfm_playcount: int | None = None
    popularity: int | None = None
    popularity_score: float | None = None
    popularity_confidence: float | None = None


class TrackRow(BaseModel):
    """Full library track record.

    Returned by ``get_library_track_by_id()``, ``get_library_tracks()``, etc.
    The ``mood_json`` field is kept as-is (may be dict or None).
    """
    model_config = ConfigDict(from_attributes=True)

    id: int
    storage_id: str | None = None
    album_id: int | None = None
    artist: str
    album: str
    slug: str | None = None
    filename: str
    title: str | None = None
    track_number: int | None = None
    disc_number: int = 1
    format: str | None = None
    bitrate: int | None = None
    sample_rate: int | None = None
    bit_depth: int | None = None
    duration: float | None = None
    size: int | None = None
    year: str | None = None
    genre: str | None = None
    albumartist: str | None = None
    musicbrainz_albumid: str | None = None
    musicbrainz_trackid: str | None = None
    path: str
    updated_at: datetime | None = None

    # Audio analysis
    bpm: float | None = None
    audio_key: str | None = None
    audio_scale: str | None = None
    energy: float | None = None
    mood_json: Any | None = None
    danceability: float | None = None
    valence: float | None = None
    acousticness: float | None = None
    instrumentalness: float | None = None
    loudness: float | None = None
    dynamic_range: float | None = None
    spectral_complexity: float | None = None
    analysis_state: str = "pending"
    bliss_state: str = "pending"
    bliss_vector: list[float] | None = None

    # Popularity
    lastfm_listeners: int | None = None
    lastfm_playcount: int | None = None
    lastfm_top_rank: int | None = None
    spotify_track_popularity: int | None = None
    spotify_top_rank: int | None = None
    popularity_score: float | None = None
    popularity_confidence: float | None = None
    popularity: int | None = None
    rating: int = 0


class LibraryStats(BaseModel):
    """Aggregate library statistics from ``get_library_stats()``."""
    model_config = ConfigDict(from_attributes=True)

    artists: int = 0
    albums: int = 0
    tracks: int = 0
    total_size: int = 0
    formats: dict[str, int] = {}
