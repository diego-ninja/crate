"""Typed models for Tidal download/acquisition data."""


from datetime import datetime
from pydantic import BaseModel, ConfigDict


class TidalDownloadRow(BaseModel):
    """A Tidal download queue entry."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    tidal_id: str | None = None
    artist: str | None = None
    title: str | None = None
    download_type: str = "album"  # "album" | "track" | "playlist"
    quality: str = "HI_RES_LOSSLESS"
    status: str = "pending"  # "pending" | "downloading" | "done" | "failed"
    progress: str | None = None
    error: str | None = None
    task_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class TidalMonitoredArtist(BaseModel):
    """An artist monitored for new Tidal releases."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    artist_name: str
    tidal_id: str | None = None
    last_checked: datetime | None = None
    created_at: datetime | None = None


class NewReleaseRow(BaseModel):
    """A detected new release (from any source)."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    artist_name: str | None = None
    artist_id: int | None = None
    artist_slug: str | None = None
    album_title: str | None = None
    release_type: str | None = None
    release_date: str | None = None
    tidal_url: str | None = None
    cover_url: str | None = None
    status: str = "detected"
    detected_at: datetime | None = None
