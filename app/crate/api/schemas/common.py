"""Shared API response models used across routers."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ApiErrorResponse(BaseModel):
    """Supports both FastAPI ``detail`` errors and legacy ``error`` payloads."""

    model_config = ConfigDict(extra="allow")

    detail: str | None = Field(default=None, description="FastAPI-style error detail.")
    error: str | None = Field(default=None, description="Legacy Crate error message field.")


class OkResponse(BaseModel):
    ok: bool = True


class TaskEnqueueResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    task_id: str
    status: str | None = None
    deduplicated: bool | None = None


class SnapshotMetadataResponse(BaseModel):
    scope: str
    subject_key: str
    version: int
    built_at: datetime | str | None = None
    stale_after: datetime | str | None = None
    stale: bool = False
    generation_ms: int = 0
