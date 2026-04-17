"""Schema models for artwork endpoints."""

from typing import Any

from pydantic import BaseModel, ConfigDict

from crate.api.schemas.common import TaskEnqueueResponse


class ArtworkMissingAlbumResponse(BaseModel):
    name: str
    display_name: str
    artist: str
    year: str | int | None = None
    mbid: str | None = None
    path: str | None = None


class ArtworkMissingResponse(BaseModel):
    missing_count: int
    albums: list[ArtworkMissingAlbumResponse]


class ArtworkScanRequest(BaseModel):
    auto_apply: bool = False


class ArtworkApplyRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


class ArtworkFetchRequest(BaseModel):
    mbid: str
    path: str | None = None


class ArtworkExtractRequest(BaseModel):
    path: str


class ArtworkQueuedResponse(TaskEnqueueResponse):
    status: str | None = None


class ArtworkExtractResponse(BaseModel):
    status: str
    path: str
