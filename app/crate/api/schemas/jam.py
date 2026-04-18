"""Schema models for jam session endpoints."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class _JamModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class JamRoomCreateRequest(_JamModel):
    name: str


class JamInviteCreateRequest(_JamModel):
    expires_in_hours: int = 24
    max_uses: int | None = 20


class JamInviteJoinRequest(_JamModel):
    role: str = "collab"


class JamMemberResponse(_JamModel):
    room_id: str | UUID | None = None
    user_id: int
    role: str
    joined_at: str | datetime | None = None
    last_seen_at: str | datetime | None = None
    username: str | None = None
    display_name: str | None = None
    avatar: str | None = None


class JamEventResponse(_JamModel):
    id: int | None = None
    room_id: str | UUID | None = None
    user_id: int | None = None
    event_type: str | None = None
    payload_json: Any | None = None
    created_at: str | datetime | None = None


class JamRoomResponse(_JamModel):
    id: str | UUID
    host_user_id: int | None = None
    name: str
    status: str | None = None
    created_at: str | datetime | None = None
    ended_at: str | datetime | None = None
    current_track_payload: Any | None = None
    members: list[JamMemberResponse] = Field(default_factory=list)
    events: list[JamEventResponse] = Field(default_factory=list)


class JamInviteResponse(_JamModel):
    token: str
    room_id: str | UUID | None = None
    created_by: int | None = None
    expires_at: str | datetime | None = None
    max_uses: int | None = None
    use_count: int | None = None
    created_at: str | datetime | None = None
    join_url: str | None = None
    qr_value: str | None = None


class JamJoinResponse(_JamModel):
    ok: bool = True
    room: JamRoomResponse
    event: JamEventResponse | None = None
