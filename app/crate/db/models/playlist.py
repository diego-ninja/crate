"""Typed models for playlist-related data."""


from datetime import datetime
from pydantic import BaseModel, ConfigDict


class PlaylistRow(BaseModel):
    """Full playlist record from the playlists table."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None = None
    user_id: int | None = None
    scope: str = "user"  # "user" | "system" | "collaborative"
    is_smart: bool = False
    smart_rules: dict | None = None
    is_public: bool = False
    is_active: bool = True
    track_count: int = 0
    invite_token: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class PlaylistTrackRow(BaseModel):
    """A track within a playlist, including its position."""
    model_config = ConfigDict(from_attributes=True)

    playlist_id: int
    track_id: int | None = None
    track_entity_uid: str | None = None
    track_path: str | None = None
    track_storage_id: str | None = None
    position: int = 0
    added_by: int | None = None
    added_at: datetime | None = None


class PlaylistSummary(BaseModel):
    """Lightweight playlist info for list views."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    scope: str = "user"
    track_count: int = 0
    is_smart: bool = False
    is_public: bool = False
    is_active: bool = True
    user_id: int | None = None
