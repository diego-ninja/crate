"""Schema models for browse artist and album endpoints."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, RootModel, field_validator

from crate.api.schemas.common import TaskEnqueueResponse


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


class GenreProfileResponse(BaseModel):
    name: str
    slug: str | None = None
    source: str | None = None
    weight: float | None = None
    share: float | None = None
    percent: int | None = None


class ArtistBrowseItemResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int | None = None
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


class ArtistAlbumSummaryResponse(BaseModel):
    id: int
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


class ArtistDetailResponse(BaseModel):
    id: int | None = None
    slug: str | None = None
    name: str
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


class ArtistTopTrackResponse(BaseModel):
    id: str
    track_id: int
    title: str
    artist: str
    artist_id: int | None = None
    artist_slug: str | None = None
    album: str
    album_id: int | None = None
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


class ArtistSetlistTrackResponse(BaseModel):
    library_track_id: int
    track_storage_id: str | None = None
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


class AlbumTrackResponse(BaseModel):
    id: int
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
    tags: AlbumTrackTagsResponse
    path: str


class AlbumDetailResponse(BaseModel):
    id: int
    slug: str | None = None
    artist_id: int | None = None
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
