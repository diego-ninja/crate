"""Schema models for playlist endpoints."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from crate.api.schemas.common import IdentityFieldsMixin, OkResponse


class PlaylistTrackInput(IdentityFieldsMixin):
    model_config = ConfigDict(extra="allow")

    entity_uid: str | None = None
    path: str | None = None
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    duration: float | int | None = None
    track_id: int | None = None
    libraryTrackId: int | None = None

class CreatePlaylistRequest(BaseModel):
    name: str
    description: str = ""
    cover_data_url: str | None = None
    is_smart: bool = False
    smart_rules: dict[str, Any] | None = None
    visibility: str | None = None
    is_collaborative: bool = False


class UpdatePlaylistRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    cover_data_url: str | None = None
    smart_rules: dict[str, Any] | None = None
    visibility: str | None = None
    is_collaborative: bool | None = None


class AddTracksRequest(BaseModel):
    tracks: list[PlaylistTrackInput]


class ReorderRequest(BaseModel):
    track_ids: list[int]


class PlaylistMemberRequest(BaseModel):
    user_id: int
    role: str = "collab"


class PlaylistInviteRequest(BaseModel):
    expires_in_hours: int = 168
    max_uses: int | None = 20


class PlaylistArtworkTrackResponse(IdentityFieldsMixin):
    model_config = ConfigDict(extra="allow")

    artist: str | None = None
    artist_id: int | None = None
    artist_entity_uid: str | None = None
    artist_slug: str | None = None
    album: str | None = None
    album_id: int | None = None
    album_entity_uid: str | None = None
    album_slug: str | None = None


class PlaylistTrackResponse(IdentityFieldsMixin):
    model_config = ConfigDict(extra="allow")

    id: int | None = None
    playlist_id: int | None = None
    track_id: int | None = None
    track_entity_uid: str | None = None
    track_path: str | None = None
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    duration: float | int | None = None
    position: int | None = None
    added_at: datetime | str | None = None
    artist_id: int | None = None
    artist_entity_uid: str | None = None
    artist_slug: str | None = None
    album_id: int | None = None
    album_entity_uid: str | None = None
    album_slug: str | None = None


class PlaylistMemberResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    playlist_id: int
    user_id: int
    role: str
    invited_by: int | None = None
    created_at: datetime | str | None = None
    username: str | None = None
    display_name: str | None = None
    avatar: str | None = None


class PlaylistSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    name: str
    description: str | None = None
    cover_data_url: str | None = None
    cover_path: str | None = None
    user_id: int | None = None
    is_smart: bool | None = None
    smart_rules: dict[str, Any] | None = None
    scope: str | None = None
    visibility: str | None = None
    is_collaborative: bool | None = None
    generation_mode: str | None = None
    is_curated: bool | None = None
    is_active: bool | None = None
    is_system: bool | None = None
    managed_by_user_id: int | None = None
    curation_key: str | None = None
    featured_rank: int | None = None
    category: str | None = None
    created_at: datetime | str | None = None
    updated_at: datetime | str | None = None
    track_count: int | None = None
    total_duration: float | int | None = None
    artwork_tracks: list[PlaylistArtworkTrackResponse] = Field(default_factory=list)


class PlaylistDetailResponse(PlaylistSummaryResponse):
    tracks: list[PlaylistTrackResponse] = Field(default_factory=list)
    members: list[PlaylistMemberResponse] = Field(default_factory=list)


class PlaylistFilterOptionsResponse(BaseModel):
    genres: list[str]
    formats: list[str]
    keys: list[str]
    scales: list[str]
    artists: list[str]
    year_range: list[str | int]
    bpm_range: list[int]


class PlaylistCreateResponse(BaseModel):
    id: int


class PlaylistTracksAddedResponse(OkResponse):
    added: int


class PlaylistGenerateResponse(OkResponse):
    track_count: int


class PlaylistMembersMutationResponse(OkResponse):
    members: list[PlaylistMemberResponse] = Field(default_factory=list)


class PlaylistInviteResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    token: str
    playlist_id: int
    created_by: int | None = None
    expires_at: datetime | str | None = None
    max_uses: int | None = None
    use_count: int | None = None
    created_at: datetime | str | None = None
    join_url: str
    qr_value: str


class PlaylistInviteAcceptResponse(OkResponse):
    playlist_id: int
    members: list[PlaylistMemberResponse] = Field(default_factory=list)
