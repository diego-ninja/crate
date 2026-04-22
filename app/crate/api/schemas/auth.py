"""Schema models for authentication and user management endpoints."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from crate.api.schemas.common import OkResponse


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str | None = None
    invite_token: str | None = None


class CreateUserRequest(BaseModel):
    email: str
    password: str
    name: str | None = None
    role: str = "user"


class OAuthStartRequest(BaseModel):
    return_to: str | None = None
    invite_token: str | None = None


class ProviderToggleRequest(BaseModel):
    enabled: bool


class AuthConfigUpdateRequest(BaseModel):
    invite_only: bool


class HeartbeatRequest(BaseModel):
    app_id: str | None = None
    device_label: str | None = None


class AuthInviteRequest(BaseModel):
    email: str | None = None
    expires_in_hours: int = 168
    max_uses: int | None = 1


class UpdateProfileRequest(BaseModel):
    name: str | None = None
    username: str | None = None
    bio: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class AuthUserPublicResponse(BaseModel):
    id: int | None = None
    email: str
    name: str | None = None
    avatar: str | None = None
    role: str


class AuthExternalIdentityResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    user_id: int | None = None
    provider: str
    external_user_id: str | None = None
    external_username: str | None = None
    status: str | None = None
    last_error: str | None = None
    last_task_id: str | None = None
    metadata_json: dict[str, Any] | str | None = None
    last_synced_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AuthSessionResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    user_id: int | None = None
    expires_at: datetime | None = None
    created_at: datetime | None = None
    last_seen_at: datetime | None = None
    last_seen_ip: str | None = None
    user_agent: str | None = None
    app_id: str | None = None
    device_label: str | None = None
    revoked_at: datetime | None = None


class AdminUserCurrentTrackResponse(BaseModel):
    track_id: int | None = None
    track_storage_id: str | None = None
    title: str | None = None
    artist: str | None = None
    artist_id: int | None = None
    artist_slug: str | None = None
    album: str | None = None
    album_id: int | None = None
    album_slug: str | None = None
    played_at: datetime | None = None


class AuthCurrentSessionResponse(BaseModel):
    id: str
    expires_at: datetime | None = None


class AuthLoginResponse(AuthUserPublicResponse):
    token: str
    session: AuthCurrentSessionResponse | None = None


class AuthMeResponse(AuthUserPublicResponse):
    username: str | None = None
    bio: str | None = None
    session_id: str | None = None
    connected_accounts: list[AuthExternalIdentityResponse] = Field(default_factory=list)


class AuthConfigResponse(BaseModel):
    google: bool
    apple: bool
    discogs: bool
    password: bool
    invite_only: bool


class AuthProviderResponse(BaseModel):
    enabled: bool
    configured: bool
    login_url: str | None = None


class AuthProvidersResponse(BaseModel):
    password: AuthProviderResponse
    google: AuthProviderResponse
    apple: AuthProviderResponse


class RevokeSessionsResponse(OkResponse):
    revoked: int


class SubsonicTokenResponse(BaseModel):
    subsonic_token: str | None = None


class OAuthStartResponse(BaseModel):
    provider: str
    login_url: str


class AuthInviteResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    token: str
    email: str | None = None
    created_by: int | None = None
    expires_at: datetime | None = None
    max_uses: int | None = None
    use_count: int | None = None
    accepted_at: datetime | None = None
    created_at: datetime | None = None


class AdminAuthConfigResponse(BaseModel):
    invite_only: bool


class AdminUserSummaryResponse(AuthUserPublicResponse):
    model_config = ConfigDict(extra="allow")

    username: str | None = None
    bio: str | None = None
    google_id: str | None = None
    active_sessions: int | None = None
    connected_accounts: list[AuthExternalIdentityResponse] = Field(default_factory=list)
    created_at: datetime | None = None
    last_login: datetime | None = None
    last_seen_at: datetime | None = None
    active_devices: int | None = None
    online_now: bool = False
    listening_now: bool = False
    last_played_at: datetime | None = None
    current_track: AdminUserCurrentTrackResponse | None = None


class AdminUserDetailResponse(AuthMeResponse):
    created_at: datetime | None = None
    last_login: datetime | None = None
    last_seen_at: datetime | None = None
    active_sessions: int | None = None
    active_devices: int | None = None
    online_now: bool = False
    listening_now: bool = False
    last_played_at: datetime | None = None
    current_track: AdminUserCurrentTrackResponse | None = None
    sessions: list[AuthSessionResponse] = Field(default_factory=list)
