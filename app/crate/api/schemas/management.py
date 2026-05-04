"""Schema models for management and admin operations."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from crate.api.schemas.common import OkResponse, SnapshotMetadataResponse


class DeleteRequest(BaseModel):
    mode: str = "db_only"


class RepairRequest(BaseModel):
    dry_run: bool = True
    auto_only: bool = True


class RepairIssuesRequest(BaseModel):
    issues: list[dict[str, Any]] = Field(default_factory=list)
    dry_run: bool = False
    plan_version: str | None = None
    plan_item_ids: list[str] = Field(default_factory=list)
    confirm_risky: bool = False


class RepairPreviewRequest(BaseModel):
    issues: list[dict[str, Any]] = Field(default_factory=list)
    auto_only: bool = False


class RepairCatalogEntryResponse(BaseModel):
    check_type: str
    scanner_method: str
    fixer_method: str | None = None
    support: str
    risk: str
    scope: str
    requires_confirmation: bool = False
    supports_batch: bool = True
    supports_artist_scope: bool = True
    supports_global_scope: bool = True
    auto_fixable: bool


class RepairCatalogResponse(BaseModel):
    items: list[RepairCatalogEntryResponse] = Field(default_factory=list)


class RepairPlanItemResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    issue_id: int | None = None
    item_key: str | None = None
    plan_item_id: str | None = None
    check_type: str
    severity: str | None = None
    description: str | None = None
    support: str
    risk: str | None = None
    scope: str | None = None
    requires_confirmation: bool = False
    supports_batch: bool = True
    supports_artist_scope: bool = True
    supports_global_scope: bool = True
    auto_fixable: bool = False
    executable: bool = False
    action: str | None = None
    target: str | None = None
    message: str | None = None
    fs_write: bool = False
    details: dict[str, Any] | list[Any] | str | None = None
    issue: dict[str, Any] = Field(default_factory=dict)


class RepairPreviewResponse(BaseModel):
    items: list[RepairPlanItemResponse] = Field(default_factory=list)
    total: int = 0
    executable: int = 0
    manual_only: int = 0
    plan_version: str | None = None
    generated_at: datetime | str | None = None


class ArtistRepairPlanResponse(RepairPreviewResponse):
    artist: str


class MoveRequest(BaseModel):
    new_name: str


class WipeRequest(BaseModel):
    rebuild: bool = False


class EnrichMbidsRequest(BaseModel):
    artist: str | None = None
    min_score: int | float | None = None


class StorageMigrationRequest(BaseModel):
    artist: str | None = None


class PortableMetadataRequest(BaseModel):
    album_id: int | None = None
    album_entity_uid: str | None = None
    artist: str | None = None
    write_audio_tags: bool = True
    write_sidecars: bool = True
    limit: int | None = Field(default=None, ge=1, le=10000)


class PortableRehydrateRequest(BaseModel):
    root_path: str | None = None
    limit: int | None = Field(default=None, ge=1, le=10000)


class RichMetadataExportRequest(BaseModel):
    album_id: int | None = None
    album_entity_uid: str | None = None
    artist: str | None = None
    export_root: str | None = None
    include_audio: bool = False
    write_rich_tags: bool = True
    limit: int | None = Field(default=None, ge=1, le=10000)


class LyricsSyncRequest(BaseModel):
    artist: str | None = None
    album_id: int | None = None
    album_entity_uid: str | None = None
    track_id: int | None = Field(default=None, ge=1)
    track_entity_uid: str | None = None
    force: bool = False
    limit: int = Field(default=500, ge=1, le=5000)
    delay_seconds: float = Field(default=0.2, ge=0, le=10)


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


class AdminHealthSnapshotResponse(BaseModel):
    snapshot: SnapshotMetadataResponse
    issues: list[HealthIssueResponse] = Field(default_factory=list)
    counts: dict[str, int] = Field(default_factory=dict)
    total: int = 0
    filter: str | None = None


class CheckTypeMutationResponse(OkResponse):
    check_type: str


class HealthFixTypeResponse(BaseModel):
    task_id: str | None = None
    fixable: int
    allowed: bool = True
    reason: str | None = None


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
    fingerprint_done: int = 0
    fingerprint_pending: int = 0
    fingerprint_chromaprint: int = 0
    fingerprint_pcm: int = 0
    chromaprint_available: bool = False
    fingerprint_strategy: str = "unavailable"
    total_albums: int = 0
    lyrics_cached: int = 0
    lyrics_found: int = 0
    lyrics_missing: int = 0
    portable_sidecar_albums: int = 0
    portable_audio_tag_albums: int = 0
    portable_audio_tag_tracks: int = 0
    portable_tag_errors: int = 0
    rich_export_albums: int = 0
    rich_export_tracks: int = 0
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
