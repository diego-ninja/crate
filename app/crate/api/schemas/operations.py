"""Schema models for setup, scanner, matcher, duplicates, and batch endpoints."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from crate.api.schemas.analytics import (
    ActivityLiveResponse,
    ActivityRecentResponse,
    AnalyticsOverviewResponse,
    StatsResponse,
)
from crate.api.schemas.common import IdentityFieldsMixin, SnapshotMetadataResponse, TaskEnqueueResponse
from crate.api.schemas.management import AnalysisStatusResponse


class SetupAdminRequest(BaseModel):
    email: str
    password: str
    name: str = ""


class SetupKeysRequest(BaseModel):
    lastfm_apikey: str = ""
    ticketmaster_api_key: str = ""
    spotify_id: str = ""
    spotify_secret: str = ""
    fanart_api_key: str = ""
    setlistfm_api_key: str = ""


class SetupStatusResponse(BaseModel):
    needs_setup: bool


class SetupAdminResponse(BaseModel):
    id: int
    email: str


class SetupKeysResponse(BaseModel):
    saved: int


class SetupCheckResponse(BaseModel):
    has_lastfm: bool
    has_ticketmaster: bool
    has_spotify: bool
    has_fanart: bool
    has_setlistfm: bool
    library_stats: Any


class ScanRequest(BaseModel):
    only: str | None = None


class ScanStartResponse(TaskEnqueueResponse):
    status: str
    only: str | None = None


class ScannerStatusResponse(BaseModel):
    scanning: bool
    last_scan: datetime | str | None = None
    issue_count: int
    progress: Any = None
    pending_imports: int = 0
    running_tasks: int = 0


class AdminOpsRuntimeResponse(BaseModel):
    active_users_5m: int = 0
    streams_3m: int = 0


class AdminDomainEventPreviewResponse(BaseModel):
    id: str
    event_type: str = ""
    scope: str = ""
    subject_key: str = ""


class AdminDomainEventRuntimeResponse(BaseModel):
    redis_connected: bool = False
    stream_key: str = ""
    consumer_group: str = ""
    latest_sequence: int = 0
    stream_length: int = 0
    pending: int = 0
    consumers: int = 0
    lag: int = 0
    last_delivered_id: str | None = None
    recent_events: list[AdminDomainEventPreviewResponse] = Field(default_factory=list)


class AdminCacheInvalidationRuntimeResponse(BaseModel):
    redis_connected: bool = False
    events_key: str = ""
    latest_event_id: int = 0
    retained_events: int = 0


class AdminSseSurfaceResponse(BaseModel):
    name: str
    endpoint: str | None = None
    channel: str
    mode: str
    description: str | None = None


class AdminEventingRuntimeResponse(BaseModel):
    redis_connected: bool = False
    domain_events: AdminDomainEventRuntimeResponse = Field(default_factory=AdminDomainEventRuntimeResponse)
    cache_invalidation: AdminCacheInvalidationRuntimeResponse = Field(default_factory=AdminCacheInvalidationRuntimeResponse)
    sse_surfaces: list[AdminSseSurfaceResponse] = Field(default_factory=list)


class AdminOpsSnapshotResponse(BaseModel):
    snapshot: SnapshotMetadataResponse
    status: ScannerStatusResponse
    stats: StatsResponse
    analytics: AnalyticsOverviewResponse
    live: ActivityLiveResponse
    recent: ActivityRecentResponse
    analysis: AnalysisStatusResponse
    health_counts: dict[str, int] = Field(default_factory=dict)
    upcoming_shows: list[dict[str, Any]] = Field(default_factory=list)
    runtime: AdminOpsRuntimeResponse = Field(default_factory=AdminOpsRuntimeResponse)
    eventing: AdminEventingRuntimeResponse = Field(default_factory=AdminEventingRuntimeResponse)


class WorkerLogEntryResponse(BaseModel):
    id: int
    worker_id: str
    task_id: str | None = None
    level: str
    category: str
    message: str
    metadata: dict[str, Any] | None = None
    created_at: datetime | str | None = None


class WorkerLogWorkerResponse(BaseModel):
    worker_id: str
    last_seen: datetime | str | None = None
    log_count: int = 0


class AdminLogsSnapshotResponse(BaseModel):
    snapshot: SnapshotMetadataResponse
    logs: list[WorkerLogEntryResponse] = Field(default_factory=list)
    workers: list[WorkerLogWorkerResponse] = Field(default_factory=list)


class ScanIssueResponse(BaseModel):
    model_config = ConfigDict(extra="allow")


class FixRequest(BaseModel):
    dry_run: bool = True


class FixIssuesResponse(BaseModel):
    dry_run: bool
    threshold: int
    auto_fixable: int
    needs_review: int
    task_id: str | None = None


class MatchApplyRequest(IdentityFieldsMixin):
    album_id: int | None = None
    album_entity_uid: str | None = None
    release: dict[str, Any]


class MatchCandidateTrackResponse(BaseModel):
    disc: int | None = None
    number: str | int | None = None
    title: str | None = None
    length_sec: int | None = None
    mbid: str | None = None


class MatchCandidateResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    mbid: str | None = None
    title: str | None = None
    artist: str | None = None
    date: str | None = None
    country: str | None = None
    track_count: int | None = None
    release_group_id: str | None = None
    tracks: list[MatchCandidateTrackResponse] = Field(default_factory=list)
    match_score: int | float | None = None
    tag_preview: dict[str, Any] | None = None


class DuplicateTrackInfoResponse(BaseModel):
    filename: str
    format: str
    size_mb: float | int
    bitrate: int | None = None
    length_sec: int
    title: str
    tracknumber: str


class DuplicateAlbumCompareResponse(BaseModel):
    path: str
    name: str
    artist: str
    track_count: int
    total_size_mb: float | int
    formats: list[str]
    has_cover: bool
    tracks: list[DuplicateTrackInfoResponse]


class ResolveRequest(BaseModel):
    keep: str
    remove: list[str]


class BatchAlbumItem(BaseModel):
    artist: str
    album: str


class BatchRetagRequest(BaseModel):
    albums: list[BatchAlbumItem]


class BatchCoverItem(BaseModel):
    mbid: str | None = None
    path: str


class BatchFetchCoversRequest(BaseModel):
    albums: list[BatchCoverItem]


class BatchTaskEnqueueResponse(BaseModel):
    status: str
    task_id: str
    count: int
