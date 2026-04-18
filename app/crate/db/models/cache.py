"""Typed models for cache-related data."""


from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict


class CacheEntry(BaseModel):
    """A cached value with metadata."""
    model_config = ConfigDict(from_attributes=True)

    key: str
    value: Any = None
    updated_at: datetime | None = None
