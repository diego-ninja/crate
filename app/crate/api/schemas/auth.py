"""Schema models for authentication and user management endpoints."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from crate.api.schemas.common import IdentityFieldsMixin, OkResponse


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
    roles: list[str] | None = None


class UpdateUserRoleRequest(BaseModel):
    role: str | None = None
    roles: list[str] | None = None


class UpdateUserStatusRequest(BaseModel):
    status: str
    reason: str | None = None
    revoke_sessions: bool = True


class OAuthStartRequest(BaseModel):
    return_to: str | None = None
    invite_token: str | None = None
    native_code_challenge: str | None = None
    native_state: str | None = None


class NativeOAuthExchangeRequest(BaseModel):
    code: str = Field(min_length=16, max_length=256)
    code_verifier: str = Field(min_length=43, max_length=128)
    state: str = Field(min_length=16, max_length=256)


class ProviderToggleRequest(BaseModel):
    enabled: bool


class AuthConfigUpdateRequest(BaseModel):
    invite_only: bool


class HeartbeatRequest(BaseModel):
    app_id: str | None = None
    device_label: str | None = None


class RefreshTokenRequest(BaseModel):
    refresh_token: str | None = None


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


class AdminSetPasswordRequest(BaseModel):
    new_password: str
    revoke_all_sessions: bool = True


class AuthUserPublicResponse(BaseModel):
    id: int | None = None
    email: str
    name: str | None = None
    avatar: str | None = None
    role: str
    roles: list[str] = Field(default_factory=list)


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
    display_label: str | None = None
    client_name: str | None = None
    client_version: str | None = None
    os_name: str | None = None
    os_version: str | None = None
    device_type: str | None = None
    device_brand: str | None = None
    device_model: str | None = None
    device_fingerprint: str | None = None
    activity_state: str | None = None
    is_active: bool | None = None
    is_recent: bool | None = None
    revoked_at: datetime | None = None


class AdminUserCurrentTrackResponse(IdentityFieldsMixin):
    track_id: int | None = None
    track_entity_uid: str | None = None
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
    access_expires_at: datetime | None = None
    refresh_token: str | None = None
    session: AuthCurrentSessionResponse | None = None


class AuthRefreshResponse(BaseModel):
    token: str
    access_expires_at: datetime | None = None
    refresh_token: str | None = None
    session: AuthCurrentSessionResponse | None = None


class AuthMeResponse(AuthUserPublicResponse):
    username: str | None = None
    bio: str | None = None
    session_id: str | None = None
    capabilities: list[str] = Field(default_factory=list)
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
    capabilities: list[str] = Field(default_factory=list)
    status: str = "active"
    status_reason: str | None = None
    suspended_at: datetime | None = None
    deleted_at: datetime | None = None
    google_id: str | None = None
    has_password: bool = False
    active_sessions: int | None = None
    connected_accounts: list[AuthExternalIdentityResponse] = Field(default_factory=list)
    created_at: datetime | None = None
    last_login: datetime | None = None
    last_seen_at: datetime | None = None
    last_activity_at: datetime | None = None
    activity_status: str = "never_active"
    active_devices: int | None = None
    online_now: bool = False
    listening_now: bool = False
    last_played_at: datetime | None = None
    current_track: AdminUserCurrentTrackResponse | None = None


class AdminUserDetailResponse(AuthMeResponse):
    status: str = "active"
    status_reason: str | None = None
    suspended_at: datetime | None = None
    deleted_at: datetime | None = None
    has_password: bool = False
    created_at: datetime | None = None
    last_login: datetime | None = None
    last_seen_at: datetime | None = None
    last_activity_at: datetime | None = None
    activity_status: str = "never_active"
    active_sessions: int | None = None
    active_devices: int | None = None
    online_now: bool = False
    listening_now: bool = False
    last_played_at: datetime | None = None
    current_track: AdminUserCurrentTrackResponse | None = None
    sessions: list[AuthSessionResponse] = Field(default_factory=list)
