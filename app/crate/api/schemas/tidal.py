"""Schema models for Tidal API endpoints."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class TidalStatusResponse(BaseModel):
    authenticated: bool


class TidalAuthMutationResponse(BaseModel):
    success: bool


class TidalAlbumResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    title: str
    artist: str
    year: str | int | None = None
    tracks: int | None = None
    cover: str | None = None
    url: str
    quality: list[str] = Field(default_factory=list)


class TidalTrackResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    title: str
    artist: str
    album: str
    duration: int | float = 0
    url: str
    quality: list[str] = Field(default_factory=list)


class TidalArtistResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    picture: str | None = None


class TidalSearchResponse(BaseModel):
    albums: list[TidalAlbumResponse] = Field(default_factory=list)
    artists: list[TidalArtistResponse] = Field(default_factory=list)
    tracks: list[TidalTrackResponse] = Field(default_factory=list)


class TidalMissingResponse(BaseModel):
    albums: list[TidalAlbumResponse] = Field(default_factory=list)
    authenticated: bool


class DownloadMissingAlbumRequest(BaseModel):
    url: str = ""
    title: str = ""
    cover_url: str = ""


class TidalDownloadMissingRequest(BaseModel):
    albums: list[DownloadMissingAlbumRequest] = Field(default_factory=list)
    quality: str = "max"


class TidalDownloadMissingResponse(BaseModel):
    queued: int


class DownloadRequest(BaseModel):
    url: str
    quality: str = "max"
    source: str = "search"
    title: str = ""


class BatchDownloadItemRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    url: str
    tidal_id: str | None = None
    content_type: str | None = None
    title: str = ""
    artist: str | None = None
    cover_url: str | None = None
    quality: str = "max"
    source: str = "batch"
    metadata: dict[str, Any] | None = None


class BatchDownloadRequest(BaseModel):
    items: list[BatchDownloadItemRequest] = Field(default_factory=list)


class TidalDownloadResponse(BaseModel):
    task_id: str
    download_id: int


class BatchDownloadItemResponse(BaseModel):
    download_id: int
    task_id: str
    title: str = ""


class BatchDownloadResponse(BaseModel):
    queued: int
    items: list[BatchDownloadItemResponse] = Field(default_factory=list)


class TidalQueueItemResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    tidal_url: str
    tidal_id: str
    content_type: str
    title: str
    artist: str | None = None
    cover_url: str | None = None
    quality: str
    status: str
    priority: int | None = None
    source: str | None = None
    task_id: str | None = None
    error: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str | None = None
    completed_at: str | None = None


class WishlistRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    url: str = ""
    tidal_id: str | None = None
    content_type: str = "album"
    title: str = ""
    artist: str | None = None
    cover_url: str | None = None
    quality: str = "max"
    metadata: dict[str, Any] | None = None


class WishlistResponse(BaseModel):
    id: int


class QueueUpdateRequest(BaseModel):
    status: str | None = None
    priority: int | None = None


class TidalArtistRefResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str | None = None
    name: str
    picture: str | None = None


class DiscographyAlbumResponse(TidalAlbumResponse):
    status: str


class TidalDiscographyResponse(BaseModel):
    artist: str
    tidal_artist: TidalArtistRefResponse | None = None
    albums: list[DiscographyAlbumResponse] = Field(default_factory=list)
    error: str | None = None


class MissingMatchResponse(BaseModel):
    missing_title: str
    missing_year: str | int | None = None
    missing_type: str | None = None
    tidal_match: TidalAlbumResponse | None = None
    match_score: int


class MatchMissingResponse(BaseModel):
    artist: str
    matches: list[MissingMatchResponse] = Field(default_factory=list)
    total_missing: int
    matched: int | None = None


class MonitorRequest(BaseModel):
    enabled: bool = True


class MonitorToggleResponse(BaseModel):
    artist: str
    monitored: bool


class MonitoredArtistResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    artist_name: str
    tidal_id: str | None = None
    enabled: bool = True
    last_checked: str | None = None


class CheckMonitoredResponse(BaseModel):
    artist: str
    monitored: bool
