"""Typed models for show/concert data."""


import datetime as _dt
from pydantic import BaseModel, ConfigDict


class ShowRow(BaseModel):
    """An upcoming show/concert."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    artist_name: str
    artist_id: int | None = None
    artist_slug: str | None = None
    venue: str | None = None
    city: str | None = None
    country: str | None = None
    country_code: str | None = None
    date: _dt.date | None = None
    time: str | None = None
    source: str | None = None
    source_url: str | None = None
    source_id: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    lineup: list[str] | None = None
    address: str | None = None
    postal_code: str | None = None
    state: str | None = None
    created_at: _dt.datetime | None = None
    updated_at: _dt.datetime | None = None


class ShowSummary(BaseModel):
    """Lightweight show for list views."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    artist_name: str
    venue: str | None = None
    city: str | None = None
    date: _dt.date | None = None
    source: str | None = None
