"""Schema models for search, track metadata, and media-browse endpoints."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, RootModel

from crate.api.schemas.common import OkResponse, TaskEnqueueResponse
from crate.api.schemas.radio import RadioTrack


class SearchArtistResultResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int | None = None
    slug: str | None = None
    name: str
    album_count: int | None = None
    has_photo: bool | int | None = None


class SearchAlbumResultResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int | None = None
    slug: str | None = None
    artist: str
    artist_id: int | None = None
    artist_slug: str | None = None
    name: str
    year: str | int | None = None
    has_cover: bool | int | None = None


class TrackRefResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int | None = None
    storage_id: str | None = None
    slug: str | None = None
    title: str
    artist: str
    artist_id: int | None = None
    artist_slug: str | None = None
    album_id: int | None = None
    album_slug: str | None = None
    album: str
    path: str
    duration: float | int | None = None


class SearchResponse(BaseModel):
    artists: list[SearchArtistResultResponse] = Field(default_factory=list)
    albums: list[SearchAlbumResultResponse] = Field(default_factory=list)
    tracks: list[TrackRefResponse] = Field(default_factory=list)


class FavoriteItemResponse(BaseModel):
    item_type: str
    item_id: str
    created_at: datetime | str | None = None


class FavoritesResponse(BaseModel):
    items: list[FavoriteItemResponse] = Field(default_factory=list)


class FavoriteMutationRequest(BaseModel):
    item_id: str = ""
    type: str = "song"


class TrackRatingRequest(BaseModel):
    rating: int = 0
    track_id: int | None = None
    path: str | None = None


class TrackRatingResponse(OkResponse):
    rating: int


class BlissSignatureResponse(BaseModel):
    texture: float
    motion: float
    density: float


class TrackInfoResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    title: str | None = None
    artist: str | None = None
    album: str | None = None
    format: str | None = None
    bitrate: int | None = None
    sample_rate: int | None = None
    bit_depth: int | None = None
    bpm: float | int | None = None
    audio_key: str | None = None
    audio_scale: str | None = None
    energy: float | None = None
    danceability: float | None = None
    valence: float | None = None
    acousticness: float | None = None
    instrumentalness: float | None = None
    loudness: float | None = None
    dynamic_range: float | None = None
    mood_json: dict[str, Any] | list[Any] | str | None = None
    lastfm_listeners: int | None = None
    lastfm_playcount: int | None = None
    popularity: float | int | None = None
    rating: int | None = None
    bliss_signature: BlissSignatureResponse | None = None


class EqFeaturesResponse(BaseModel):
    energy: float | None = None
    loudness: float | None = None
    dynamicRange: float | None = None
    brightness: float | None = None
    danceability: float | None = None
    valence: float | None = None
    acousticness: float | None = None
    instrumentalness: float | None = None


class GenreRefResponse(BaseModel):
    slug: str
    name: str
    canonical: bool | None = None


class GenrePresetInheritedFromResponse(BaseModel):
    slug: str
    name: str


class GenrePresetResponse(BaseModel):
    gains: list[float] = Field(default_factory=list)
    source: str
    inheritedFrom: GenrePresetInheritedFromResponse | None = None


class TrackGenreResponse(BaseModel):
    primary: GenreRefResponse | None = None
    topLevel: GenreRefResponse | None = None
    source: str | None = None
    preset: GenrePresetResponse | None = None


class DiscoverCompletenessMissingAlbumResponse(BaseModel):
    title: str = ""
    type: str = ""
    year: str | int | None = None


class DiscoverCompletenessArtistResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    artist_id: int | None = None
    artist_slug: str | None = None
    artist: str
    has_photo: bool | int | None = None
    listeners: int | None = None
    local_count: int = 0
    mb_count: int = 0
    pct: int = 0
    missing: list[DiscoverCompletenessMissingAlbumResponse] = Field(default_factory=list)


class DiscoverCompletenessResponse(RootModel[list[DiscoverCompletenessArtistResponse]]):
    pass


class MoodPresetResponse(BaseModel):
    name: str
    track_count: int
    filters: dict[str, float | int] = Field(default_factory=dict)


class MoodPresetsResponse(RootModel[list[MoodPresetResponse]]):
    pass


class MoodTrackResponse(TrackRefResponse):
    bpm: float | int | None = None
    energy: float | None = None
    danceability: float | None = None
    valence: float | None = None


class MoodTracksResponse(BaseModel):
    mood: str
    filters: dict[str, float | int] = Field(default_factory=dict)
    tracks: list[MoodTrackResponse] = Field(default_factory=list)
    count: int


class SimilarTracksResponse(BaseModel):
    tracks: list[RadioTrack] = Field(default_factory=list)


class DiscoverCompletenessRefreshResponse(TaskEnqueueResponse):
    pass
