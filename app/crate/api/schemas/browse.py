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
    cnt: int | None = None
    count: int | None = None


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


class ArtistBrowseListResponse(BaseModel):
    items: list[ArtistBrowseItemResponse] = Field(default_factory=list)
    total: int
    page: int
    per_page: int


class ArtistCheckLibraryRequest(BaseModel):
    names: list[str] = Field(default_factory=list)


class ArtistCheckLibraryResponse(RootModel[dict[str, bool]]):
    pass


class ArtistAlbumSummaryResponse(IdentityFieldsMixin):
    id: int
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


class ArtistDetailResponse(IdentityFieldsMixin):
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
    issue_count: int
    is_v2: bool
    popularity: int | None = None
    popularity_score: float | None = None
    popularity_confidence: float | None = None


class ArtistTopTrackResponse(IdentityFieldsMixin):
    id: str
    track_id: int
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


class SimilarArtistResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str | None = None
    id: int | None = None
    slug: str | None = None


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


class ArtistPageResponse(BaseModel):
    artist: ArtistDetailResponse
    info: ArtistInfoResponse = Field(default_factory=ArtistInfoResponse)
    top_tracks: list[ArtistTopTrackResponse] = Field(default_factory=list)
    shows: ArtistShowsResponse
    enrichment: ArtistEnrichmentResponse = Field(default_factory=ArtistEnrichmentResponse)
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
    status: str


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
    id: int
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
    popularity_score: float | None = None
    popularity_confidence: float | None = None
    rating: int | float = 0
    stream_variants: list[AlbumTrackStreamVariantResponse] = Field(default_factory=list)
    lyrics: AlbumTrackLyricsResponse = Field(default_factory=AlbumTrackLyricsResponse)
    tags: AlbumTrackTagsResponse
    path: str

    @field_validator("entity_uid", "storage_id", mode="before")
    @classmethod
    def coerce_uuid_like(cls, value: Any) -> str | None:
        return str(value) if value is not None else None


class AlbumDetailResponse(IdentityFieldsMixin):
    id: int
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
    tracks: list[AlbumTrackResponse] = Field(default_factory=list)
    album_tags: dict[str, Any] = Field(default_factory=dict)
    musicbrainz_albumid: str | None = None
    genres: list[str] = Field(default_factory=list)
    genre_profile: list[GenreProfileResponse] = Field(default_factory=list)
    popularity: int | None = None
    popularity_score: float | None = None
    popularity_confidence: float | None = None
