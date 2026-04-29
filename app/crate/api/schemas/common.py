"""Shared API response models used across routers."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


class IdentityFieldsMixin(BaseModel):
    """Normalize UUID-like identifiers and prefer canonical entity UIDs."""

    @field_validator("entity_uid", "storage_id", "track_entity_uid", "track_storage_id", mode="before", check_fields=False)
    @classmethod
    def _coerce_uuid_like(cls, value: Any) -> str | None:
        return str(value) if value is not None else None

    @model_validator(mode="after")
    def _prefer_entity_uid(self):
        values = self.__dict__
        fields = type(self).model_fields
        if "entity_uid" in fields and "storage_id" in fields and values.get("entity_uid"):
            setattr(self, "storage_id", None)
        if "track_entity_uid" in fields and "track_storage_id" in fields and values.get("track_entity_uid"):
            setattr(self, "track_storage_id", None)
        return self
