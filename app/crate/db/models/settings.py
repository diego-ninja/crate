"""Typed models for settings data.

Covers the ``settings`` table (simple key/value store).
"""


from pydantic import BaseModel, ConfigDict


class SettingRow(BaseModel):
    """Single setting key/value pair from the ``settings`` table."""
    model_config = ConfigDict(from_attributes=True)

    key: str
    value: str | None = None
