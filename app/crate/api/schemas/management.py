"""Schema models for management and admin operations."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from crate.api.schemas.common import OkResponse


class DeleteRequest(BaseModel):
    mode: str = "db_only"


class RepairRequest(BaseModel):
    dry_run: bool = True
    auto_only: bool = True


class RepairIssuesRequest(BaseModel):
    issues: list[dict[str, Any]] = Field(default_factory=list)
    dry_run: bool = False


class MoveRequest(BaseModel):
    new_name: str


class WipeRequest(BaseModel):
    rebuild: bool = False


class EnrichMbidsRequest(BaseModel):
    artist: str | None = None
    min_score: int | float | None = None


class StorageMigrationRequest(BaseModel):
    artist: str | None = None


class HealthIssueResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    check_type: str
    severity: str
    description: str
    details_json: dict[str, Any] | list[Any] | str | None = None
    auto_fixable: bool | None = None
    status: str | None = None
    created_at: datetime | str | None = None
    resolved_at: datetime | str | None = None


class HealthReportResponse(BaseModel):
    issues: list[HealthIssueResponse] = Field(default_factory=list)
    summary: dict[str, int] = Field(default_factory=dict)
    total: int


class HealthIssuesResponse(BaseModel):
    issues: list[HealthIssueResponse] = Field(default_factory=list)
    counts: dict[str, int] = Field(default_factory=dict)
    total: int


class CheckTypeMutationResponse(OkResponse):
    check_type: str


class HealthFixTypeResponse(BaseModel):
    task_id: str | None = None
    fixable: int


class ArtistHealthIssuesResponse(BaseModel):
    artist: str
    issues: list[HealthIssueResponse] = Field(default_factory=list)
    count: int


class ArtistRepairResponse(BaseModel):
    task_id: str | None = None
    count: int


class AnalysisTrackSummaryResponse(BaseModel):
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    bpm: float | int | None = None
    audio_key: str | None = None
    energy: float | None = None
    danceability: float | None = None
    has_mood: bool | None = None
    updated_at: datetime | str | None = None


class BlissTrackSummaryResponse(BaseModel):
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    updated_at: datetime | str | None = None


class AnalysisStatusResponse(BaseModel):
    total: int = 0
    analysis_done: int = 0
    analysis_pending: int = 0
    analysis_active: int = 0
    analysis_failed: int = 0
    bliss_done: int = 0
    bliss_pending: int = 0
    bliss_active: int = 0
    bliss_failed: int = 0
    last_analyzed: AnalysisTrackSummaryResponse = Field(default_factory=AnalysisTrackSummaryResponse)
    last_bliss: BlissTrackSummaryResponse = Field(default_factory=BlissTrackSummaryResponse)


class AuditLogEntryResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    timestamp: datetime | str | None = None
    action: str
    target_type: str
    target_name: str
    details: dict[str, Any] = Field(default_factory=dict)
    user_id: int | None = None
    task_id: str | None = None


class AuditLogResponse(BaseModel):
    entries: list[AuditLogEntryResponse] = Field(default_factory=list)
    total: int
    limit: int
    offset: int


class StorageV2StatusResponse(BaseModel):
    total_artists: int = 0
    migrated_artists: int = 0
    total_albums: int = 0
    migrated_albums: int = 0
    total_tracks: int = 0
    migrated_tracks: int = 0
