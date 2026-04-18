"""Typed models for library health/repair data."""


from datetime import datetime
from pydantic import BaseModel, ConfigDict


class HealthIssue(BaseModel):
    """A detected library issue (duplicate, missing cover, etc.)."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str  # "duplicate" | "missing_cover" | "naming" | "orphan" | ...
    severity: str = "info"  # "info" | "warning" | "error"
    entity_type: str | None = None  # "artist" | "album" | "track"
    entity_name: str | None = None
    entity_path: str | None = None
    description: str | None = None
    auto_fixable: bool = False
    status: str = "open"  # "open" | "fixed" | "ignored"
    created_at: datetime | None = None
    resolved_at: datetime | None = None


class ScanResult(BaseModel):
    """Summary of a library scan."""
    model_config = ConfigDict(from_attributes=True)

    id: int | None = None
    scan_type: str | None = None
    artist_count: int = 0
    album_count: int = 0
    track_count: int = 0
    issue_count: int = 0
    duration_seconds: float = 0.0
    created_at: datetime | None = None
