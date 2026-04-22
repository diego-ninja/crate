"""Schema models for unified acquisition endpoints."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, RootModel


class AcquisitionSourceStatusResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    authenticated: bool | None = None
    connected: bool | None = None
    loggedIn: bool | None = None
    state: str | None = None
    version: str | None = None


class AcquisitionStatusResponse(BaseModel):
    tidal: AcquisitionSourceStatusResponse
    soulseek: AcquisitionSourceStatusResponse


class SoulseekSearchRequest(BaseModel):
    query: str = ""
    artist: str = ""
    album: str = ""


class SoulseekSearchStartResponse(BaseModel):
    search_id: str
    query: str


class SoulseekFileResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    filename: str
    size: int = 0
    length: int = 0
    extension: str = ""
    bitDepth: int | None = None
    sampleRate: int | None = None
    bitRate: int | None = None


class SoulseekSearchResultResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    username: str
    speed: int = 0
    freeSlot: bool = False
    album: str = ""
    artist: str = ""
    files: list[SoulseekFileResponse] = Field(default_factory=list)
    quality: str = ""
    totalSize: int = 0


class SoulseekSearchPollResponse(BaseModel):
    state: str = "Unknown"
    isComplete: bool = False
    responseCount: int = 0
    fileCount: int = 0
    results: list[SoulseekSearchResultResponse] = Field(default_factory=list)


class AcquisitionDownloadRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    source: str = ""
    artist: str = ""
    album: str = ""
    tidal_id: str = ""
    tidal_type: str = "album"
    username: str = ""
    files: list[Any] = Field(default_factory=list)
    find_alternate: bool = False
    upgrade_album_id: int | None = None


class AcquisitionDownloadResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    task_id: str
    source: str
    finding_alternate: bool | None = None
    enqueued: int | None = None


class AcquisitionUploadResponse(BaseModel):
    task_id: str
    upload_id: str
    file_count: int
    total_bytes: int


class NewReleaseResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    artist_name: str
    album_title: str
    status: str
    tidal_id: str | None = None
    tidal_url: str | None = None
    cover_url: str | None = None
    year: str | int | None = None
    tracks: int | None = None
    quality: str | None = None
    release_date: str | None = None
    release_type: str | None = None
    artist_id: int | None = None
    artist_slug: str | None = None
    album_id: int | None = None
    album_slug: str | None = None


class NewReleasesResponse(BaseModel):
    releases: list[NewReleaseResponse] = Field(default_factory=list)


class AcquisitionQueueItemResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    source: str
    artist: str = ""
    album: str = ""
    status: str = ""
    progress: Any = None
    task_id: str | None = None
    filename: str | None = None
    fullPath: str | None = None
    username: str | None = None
    speed: int | float | None = None


class AcquisitionQueueResponse(RootModel[list[AcquisitionQueueItemResponse]]):
    pass


class QueueClearResponse(BaseModel):
    cleared: bool
