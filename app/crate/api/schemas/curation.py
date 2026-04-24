"""Schema models for curation and admin system-playlist endpoints."""

from typing import Any

from pydantic import BaseModel, Field

from crate.api.schemas.common import OkResponse, SnapshotMetadataResponse
from crate.api.schemas.playlists import PlaylistDetailResponse, PlaylistSummaryResponse, PlaylistTrackResponse


class CreateSystemPlaylistRequest(BaseModel):
    name: str
    description: str | None = None
    cover_data_url: str | None = None
    generation_mode: str = "static"
    smart_rules: dict[str, Any] | None = None
    is_curated: bool = True
    is_active: bool = True
    curation_key: str | None = None
    featured_rank: int | None = None
    category: str | None = None


class UpdateSystemPlaylistRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    cover_data_url: str | None = None
    generation_mode: str | None = None
    smart_rules: dict[str, Any] | None = None
    auto_refresh_enabled: bool | None = None
    is_curated: bool | None = None
    is_active: bool | None = None
    curation_key: str | None = None
    featured_rank: int | None = None
    category: str | None = None


class PreviewSystemPlaylistRequest(BaseModel):
    smart_rules: dict[str, Any] | None = None


class SystemPlaylistSummaryResponse(PlaylistSummaryResponse):
    follower_count: int | None = None


class SystemPlaylistDetailResponse(SystemPlaylistSummaryResponse):
    tracks: list[PlaylistTrackResponse] = Field(default_factory=list)


class PlaylistGenerationLogResponse(BaseModel):
    id: int
    started_at: str
    completed_at: str | None = None
    status: str
    track_count: int | None = None
    duration_sec: int | None = None
    error: str | None = None
    triggered_by: str
    rule_snapshot: dict[str, Any] | None = None


class SystemPlaylistEditorSnapshotResponse(BaseModel):
    playlist: SystemPlaylistDetailResponse
    history: list[PlaylistGenerationLogResponse] = Field(default_factory=list)
    snapshot: SnapshotMetadataResponse | None = None


class SystemPlaylistGenerateResponse(SystemPlaylistDetailResponse):
    generated_track_count: int


class CuratedPlaylistSummaryResponse(PlaylistSummaryResponse):
    follower_count: int | None = None
    is_followed: bool = False


class CuratedPlaylistDetailResponse(CuratedPlaylistSummaryResponse):
    tracks: list[PlaylistTrackResponse] = Field(default_factory=list)


class CuratedFollowMutationResponse(OkResponse):
    followed: bool | None = None


class CuratedFollowStatusResponse(BaseModel):
    is_followed: bool
