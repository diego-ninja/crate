"""Schema models for analytics and reporting endpoints."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, RootModel

from crate.api.schemas.common import IdentityFieldsMixin


class AnalyticsTopArtistResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int | None = None
    slug: str | None = None
    name: str
    albums: int


class AnalyticsOverviewResponse(BaseModel):
    computing: bool | None = None
    formats: dict[str, int] = Field(default_factory=dict)
    decades: dict[str, int] = Field(default_factory=dict)
    top_artists: list[AnalyticsTopArtistResponse] = Field(default_factory=list)
    bitrates: dict[str, int] = Field(default_factory=dict)
    genres: dict[str, int] = Field(default_factory=dict)
    sizes_by_format_gb: dict[str, float] = Field(default_factory=dict)
    avg_tracks_per_album: float | int = 0
    total_duration_hours: float | int = 0


class ActivityTaskResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    type: str
    status: str | None = None
    created_at: datetime | str | None = None
    updated_at: datetime | str | None = None


class ActivityRecentResponse(BaseModel):
    tasks: list[ActivityTaskResponse] = Field(default_factory=list)
    pending_imports: int
    last_scan: datetime | str | None = None


class StatsGenreResponse(BaseModel):
    name: str
    count: int


class RecentAlbumResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int | None = None
    slug: str | None = None
    artist: str
    artist_id: int | None = None
    artist_slug: str | None = None
    name: str
    display_name: str | None = None
    year: str | int | None = None


class StatsResponse(BaseModel):
    artists: int
    albums: int
    tracks: int
    formats: dict[str, int] = Field(default_factory=dict)
    total_size_gb: float | int = 0
    last_scan: datetime | str | None = None
    pending_imports: int = 0
    pending_tasks: int = 0
    total_duration_hours: float | int | None = None
    avg_bitrate: float | int | None = None
    top_genres: list[StatsGenreResponse] = Field(default_factory=list)
    recent_albums: list[RecentAlbumResponse] = Field(default_factory=list)
    analyzed_tracks: int | None = None
    avg_album_duration_min: float | int | None = None
    avg_tracks_per_album: float | int | None = None


class RunningTaskResponse(BaseModel):
    id: str
    type: str
    status: str | None = None
    pool: str | None = None
    progress: str | dict[str, Any] | list[Any] | None = None
    created_at: datetime | str | None = None
    started_at: datetime | str | None = None
    updated_at: datetime | str | None = None


class RecentTaskSummaryResponse(BaseModel):
    id: str
    type: str
    status: str
    updated_at: datetime | str | None = None


class WorkerSlotsResponse(BaseModel):
    max: int
    active: int


class WorkerPoolBreakdownResponse(BaseModel):
    fast: int = 0
    default: int = 0
    heavy: int = 0
    playback: int = 0


class WorkerQueueBreakdownResponse(BaseModel):
    running: WorkerPoolBreakdownResponse = Field(default_factory=WorkerPoolBreakdownResponse)
    pending: WorkerPoolBreakdownResponse = Field(default_factory=WorkerPoolBreakdownResponse)


class DbHeavyGateResponse(BaseModel):
    active: int = 0
    pending: int = 0
    blocking: bool = False


class ActivitySystemsResponse(BaseModel):
    postgres: bool
    watcher: bool


class ActivityLiveResponse(BaseModel):
    engine: str | None = None
    running_tasks: list[RunningTaskResponse] = Field(default_factory=list)
    pending_tasks: list[RunningTaskResponse] = Field(default_factory=list)
    recent_tasks: list[RecentTaskSummaryResponse] = Field(default_factory=list)
    worker_slots: WorkerSlotsResponse
    queue_breakdown: WorkerQueueBreakdownResponse = Field(default_factory=WorkerQueueBreakdownResponse)
    db_heavy_gate: DbHeavyGateResponse = Field(default_factory=DbHeavyGateResponse)
    systems: ActivitySystemsResponse


class TimelineAlbumResponse(IdentityFieldsMixin):
    model_config = ConfigDict(extra="allow")

    id: int | None = None
    entity_uid: str | None = None
    slug: str | None = None
    artist: str
    artist_id: int | None = None
    artist_entity_uid: str | None = None
    artist_slug: str | None = None
    album: str
    tracks: int


class TimelineResponse(RootModel[dict[str, list[TimelineAlbumResponse]]]):
    pass


class QualityReportResponse(RootModel[dict[str, Any]]):
    pass


class MissingAlbumsResponse(RootModel[dict[str, Any]]):
    pass


class ArtistStatsResponse(RootModel[dict[str, Any]]):
    pass


class InsightsResponse(RootModel[dict[str, Any]]):
    pass
