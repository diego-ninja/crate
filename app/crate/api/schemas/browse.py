"""Schema models for browse artist and album endpoints."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, RootModel, field_validator

from crate.api.schemas.common import IdentityFieldsMixin, TaskEnqueueResponse
from crate.api.schemas.curation import CuratedPlaylistSummaryResponse
from crate.api.schemas.media import MoodPresetResponse
from crate.api.schemas.utility import ArtistEnrichmentResponse


class BrowseGenreFilterOptionResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    slug: str | None = None
    cnt: int | None = None
    count: int | None = None
    description: str | None = None
    top_artists: list[str] = Field(default_factory=list)
    cover_url: str | None = None


class BrowseCountryFilterOptionResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    country: str | None = None
    name: str | None = None
    cnt: int | None = None
    count: int | None = None


class BrowseFormatFilterOptionResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    format: str | None = None
    name: str | None = None
    cnt: int | None = None
    count: int | None = None


class BrowseFiltersResponse(BaseModel):
    genres: list[BrowseGenreFilterOptionResponse] = Field(default_factory=list)
    countries: list[BrowseCountryFilterOptionResponse] = Field(default_factory=list)
    decades: list[str] = Field(default_factory=list)
    formats: list[BrowseFormatFilterOptionResponse] = Field(default_factory=list)


class BrowseExplorePageResponse(BaseModel):
    filters: BrowseFiltersResponse
    playlists: list[CuratedPlaylistSummaryResponse] = Field(default_factory=list)
    moods: list[MoodPresetResponse] = Field(default_factory=list)


class GenreProfileResponse(BaseModel):
    name: str
    slug: str | None = None
    source: str | None = None
    weight: float | None = None
    share: float | None = None
    percent: int | None = None


class ArtistBrowseItemResponse(IdentityFieldsMixin):
    model_config = ConfigDict(extra="allow")

    id: int | None = None
    entity_uid: str | None = None
    slug: str | None = None
    name: str
    albums: int
    tracks: int
    total_size_mb: int
    formats: list[str] = Field(default_factory=list)
    primary_format: str | None = None
    has_photo: bool | int
    has_issues: bool
    popularity: int | None = None
    popularity_score: float | None = None
    popularity_confidence: float | None = None
    is_featured: bool = False
    featured_devices: list[str] = Field(default_factory=list)


class ArtistBrowseListResponse(BaseModel):
    items: list[ArtistBrowseItemResponse] = Field(default_factory=list)
    total: int
    page: int
    per_page: int


class ArtistCheckLibraryRequest(BaseModel):
    names: list[str] = Field(default_factory=list)


class ArtistCheckLibraryResponse(RootModel[dict[str, bool]]):
    pass


class ArtistFeaturedUpdateRequest(BaseModel):
    is_featured: bool


class ArtistAlbumSummaryResponse(IdentityFieldsMixin):
    model_config = ConfigDict(extra="allow")

    id: int | None = None
    entity_uid: str | None = None
    slug: str | None = None
    name: str
    display_name: str
    tracks: int
    formats: list[str] = Field(default_factory=list)
    bit_depth: int | None = None
    sample_rate: int | None = None
    size_mb: int
    year: str | int | None = None
    has_cover: bool | int
    musicbrainz_albumid: str | None = None
    popularity: int | None = None
    popularity_score: float | None = None
    popularity_confidence: float | None = None
    cover_url: str | None = None
    is_pre_release: bool = False
    release_date: str | None = None
    release_status: str | None = None
    release_type: str | None = None
    release_secondary_types: list[str] = Field(default_factory=list)
    release_category: str | None = None
    source_url: str | None = None


class ArtistDetailResponse(IdentityFieldsMixin):
    model_config = ConfigDict(extra="allow")

    id: int | None = None
    entity_uid: str | None = None
    slug: str | None = None
    name: str
    updated_at: datetime | str | None = None
    albums: list[ArtistAlbumSummaryResponse] = Field(default_factory=list)
    total_tracks: int
    total_size_mb: int
    primary_format: str | None = None
    genres: list[str] = Field(default_factory=list)
    genre_profile: list[GenreProfileResponse] = Field(default_factory=list)
    manual_genres: list[str] = Field(default_factory=list)
    issue_count: int
    is_v2: bool
    popularity: int | None = None
    popularity_score: float | None = None
    popularity_confidence: float | None = None
    bio: str | None = None
    tags_json: list[str] = Field(default_factory=list)
    urls_json: dict[str, str] = Field(default_factory=dict)
    mbid: str | None = None
    country: str | None = None
    area: str | None = None
    formed: str | None = None
    ended: str | None = None
    artist_type: str | None = None
    bandcamp_url: str | None = None


class ArtistTopTrackResponse(IdentityFieldsMixin):
    model_config = ConfigDict(extra="allow")

    id: str
    track_id: int | None = None
    track_entity_uid: str | None = None
    title: str
    artist: str
    artist_id: int | None = None
    artist_entity_uid: str | None = None
    artist_slug: str | None = None
    album: str
    album_id: int | None = None
    album_entity_uid: str | None = None
    album_slug: str | None = None
    duration: float | int
    track: int | str
    format: str | None = None
    bpm: float | None = None
    audio_key: str | None = None
    audio_scale: str | None = None
    energy: float | None = None
    danceability: float | None = None
    valence: float | None = None
    bliss_vector: list[float] | None = None


class SimilarArtistResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str | None = None
    id: int | None = None
    slug: str | None = None
    match: float | None = None
    image_url: str | None = None
    url: str | None = None
    source: str | None = None


class ArtistInfoResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    similar: list[SimilarArtistResponse] = Field(default_factory=list)


class ArtistShowEventResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    show_id: int | None = None
    artist_name: str
    artist_id: int | None = None
    artist_slug: str | None = None
    date: str | None = None
    local_time: str | None = None

    @field_validator("id", mode="before")
    @classmethod
    def coerce_id_to_str(cls, v: Any) -> str:
        return str(v)

    @field_validator("show_id", mode="before")
    @classmethod
    def coerce_show_id_to_int(cls, v: Any) -> int | None:
        if v is None:
            return None
        try:
            return int(v)
        except (TypeError, ValueError):
            return None

    @field_validator("date", mode="before")
    @classmethod
    def coerce_date_to_str(cls, v: Any) -> str | None:
        return str(v) if v is not None else None

    venue: str | None = None
    address_line1: str | None = None
    city: str | None = None
    region: str | None = None
    postal_code: str | None = None
    country: str | None = None
    country_code: str | None = None
    url: str | None = None
    image_url: str | None = None
    lineup: list[str] | None = None
    latitude: float | int | None = None
    longitude: float | int | None = None
    artist_genres: list[str] = Field(default_factory=list)
    probable_setlist: list[dict[str, Any]] = Field(default_factory=list)
    user_attending: bool = False
    artist_listeners: int | None = None


class ArtistShowsResponse(BaseModel):
    events: list[ArtistShowEventResponse] = Field(default_factory=list)
    configured: bool
    source: str


class ArtistPlaylistAppearanceResponse(CuratedPlaylistSummaryResponse):
    artist_track_count: int = 0


class ArtistPageResponse(BaseModel):
    artist: ArtistDetailResponse
    info: ArtistInfoResponse = Field(default_factory=ArtistInfoResponse)
    top_tracks: list[ArtistTopTrackResponse] = Field(default_factory=list)
    shows: ArtistShowsResponse
    appears_on: list[ArtistPlaylistAppearanceResponse] = Field(default_factory=list)
    enrichment: ArtistEnrichmentResponse = Field(
        default_factory=ArtistEnrichmentResponse
    )
    artist_hot_rank: int | None = None


class ShowArtistRefResponse(BaseModel):
    name: str
    id: int | None = None
    slug: str | None = None


class CachedShowEventResponse(ArtistShowEventResponse):
    lineup_artists: list[ShowArtistRefResponse] = Field(default_factory=list)


class ArtistsWithShowsResponse(BaseModel):
    artists: list[str] = Field(default_factory=list)


class CachedShowsResponse(BaseModel):
    events: list[CachedShowEventResponse] = Field(default_factory=list)


class ShowFiltersResponse(BaseModel):
    cities: list[str] = Field(default_factory=list)
    countries: list[str] = Field(default_factory=list)


class ShowsListResponse(BaseModel):
    shows: list[CachedShowEventResponse] = Field(default_factory=list)
    filters: ShowFiltersResponse


class UpcomingItemResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str
    date: str | None = None

    @field_validator("date", mode="before")
    @classmethod
    def coerce_date_to_str(cls, v: Any) -> str | None:
        return str(v) if v is not None else None


class UpcomingResponse(BaseModel):
    items: list[UpcomingItemResponse] = Field(default_factory=list)


class ArtistEnqueueResponse(TaskEnqueueResponse):
    status: str = "queued"


class ArtistTrackTitleResponse(BaseModel):
    title: str
    album: str
    album_id: int | None = None
    album_slug: str | None = None
    path: str


class ArtistSetlistTrackResponse(IdentityFieldsMixin):
    library_track_id: int
    track_entity_uid: str | None = None
    title: str
    artist: str
    artist_id: int | None = None
    artist_slug: str | None = None
    album: str
    album_id: int | None = None
    album_slug: str | None = None
    path: str
    duration: float | int | None = None
    bpm: float | None = None
    audio_key: str | None = None
    audio_scale: str | None = None
    energy: float | None = None
    danceability: float | None = None
    valence: float | None = None
    bliss_vector: list[float] | None = None
    setlist_title: str
    position: int | str | None = None


class ArtistSetlistPlayableResponse(BaseModel):
    tracks: list[ArtistSetlistTrackResponse] = Field(default_factory=list)


class ArtistNetworkResponse(RootModel[dict[str, Any]]):
    pass


class RelatedAlbumResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    name: str
    artist: str
    reason: str
    display_name: str


class AlbumTrackTagsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    title: str = ""
    artist: str = ""
    album: str = ""
    albumartist: str = ""
    tracknumber: str = ""
    discnumber: str = ""
    date: str = ""
    genre: str = ""
    musicbrainz_albumid: str | None = None
    musicbrainz_trackid: str | None = None


class AlbumTrackStreamVariantResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    track_id: int | None = None
    preset: str
    status: str
    delivery_format: str
    delivery_codec: str
    delivery_bitrate: int
    delivery_sample_rate: int | None = None
    bytes: int | None = None
    error: str | None = None
    task_id: str | None = None
    task_status: str | None = None
    updated_at: datetime | str | None = None
    completed_at: datetime | str | None = None


class AlbumTrackLyricsResponse(BaseModel):
    status: str = "none"
    found: bool = False
    has_plain: bool = False
    has_synced: bool = False
    provider: str = "lrclib"
    updated_at: datetime | str | None = None


class AlbumTrackResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int | str
    entity_uid: str | None = None
    storage_id: str | None = None
    filename: str
    format: str = ""
    size_mb: float | int
    bitrate: int | None = None
    sample_rate: int | None = None
    bit_depth: int | None = None
    length_sec: int
    popularity: int | None = None
    popularity_score: float | None = Field(default=None, exclude=True)
    popularity_confidence: float | None = Field(default=None, exclude=True)
    rating: int | float = 0
    stream_variants: list[AlbumTrackStreamVariantResponse] = Field(default_factory=list)
    lyrics: AlbumTrackLyricsResponse = Field(default_factory=AlbumTrackLyricsResponse)
    tags: AlbumTrackTagsResponse
    path: str
    is_available: bool = True
    source: str | None = None
    source_url: str | None = None

    @field_validator("entity_uid", "storage_id", mode="before")
    @classmethod
    def coerce_uuid_like(cls, value: Any) -> str | None:
        return str(value) if value is not None else None


class AlbumDetailResponse(IdentityFieldsMixin):
    model_config = ConfigDict(extra="allow")

    id: int | None = None
    entity_uid: str | None = None
    slug: str | None = None
    artist_id: int | None = None
    artist_entity_uid: str | None = None
    artist_slug: str | None = None
    artist: str
    name: str
    display_name: str
    path: str
    track_count: int
    total_size_mb: int
    total_length_sec: int
    has_cover: bool
    cover_file: str | None = None
    cover_url: str | None = None
    tracks: list[AlbumTrackResponse] = Field(default_factory=list)
    album_tags: dict[str, Any] = Field(default_factory=dict)
    musicbrainz_albumid: str | None = None
    genres: list[str] = Field(default_factory=list)
    genre_profile: list[GenreProfileResponse] = Field(default_factory=list)
    contributors: list[dict[str, Any]] = Field(default_factory=list)
    popularity: int | None = None
    popularity_score: float | None = None
    popularity_confidence: float | None = None
    playable_track_count: int | None = None
    is_pre_release: bool = False
    release_date: str | None = None
    release_status: str | None = None
    release_type: str | None = None
    source_name: str | None = None
    source_url: str | None = None
