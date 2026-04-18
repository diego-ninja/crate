"""Schema models for offline manifest endpoints."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class OfflineArtworkResponse(BaseModel):
    cover_url: str | None = None


class OfflineManifestTrackResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    storage_id: str
    track_id: int | None = None
    title: str
    artist: str
    artist_id: int | None = None
    artist_slug: str | None = None
    album: str | None = None
    album_id: int | None = None
    album_slug: str | None = None
    duration: float | int | None = None
    format: str | None = None
    bitrate: int | None = None
    sample_rate: int | None = None
    bit_depth: int | None = None
    byte_length: int | None = None
    stream_url: str
    download_url: str
    updated_at: datetime | str | None = None


class OfflineManifestResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    kind: Literal["track", "album", "playlist"]
    id: int | str
    title: str
    content_version: str
    updated_at: datetime | str | None = None
    track_count: int = 0
    total_bytes: int = 0
    tracks: list[OfflineManifestTrackResponse] = Field(default_factory=list)
    artwork: OfflineArtworkResponse | None = None
    metadata: dict[str, Any] | None = None
