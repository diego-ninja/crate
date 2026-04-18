from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column

from crate.db.engine import Base


class TidalDownload(Base):
    __tablename__ = "tidal_downloads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tidal_url: Mapped[str] = mapped_column(Text, nullable=False)
    tidal_id: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    artist: Mapped[Optional[str]] = mapped_column(Text)
    cover_url: Mapped[Optional[str]] = mapped_column(Text)
    quality: Mapped[Optional[str]] = mapped_column(Text, server_default="max")
    status: Mapped[Optional[str]] = mapped_column(Text, server_default="wishlist")
    priority: Mapped[Optional[int]] = mapped_column(Integer, server_default="0")
    source: Mapped[Optional[str]] = mapped_column(Text)
    task_id: Mapped[Optional[str]] = mapped_column(Text)
    error: Mapped[Optional[str]] = mapped_column(Text)
    metadata_json: Mapped[Optional[dict]] = mapped_column(JSON, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class TidalMonitoredArtist(Base):
    __tablename__ = "tidal_monitored_artists"

    artist_name: Mapped[str] = mapped_column(Text, primary_key=True)
    tidal_id: Mapped[Optional[str]] = mapped_column(Text)
    last_checked: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    last_release_id: Mapped[Optional[str]] = mapped_column(Text)
    enabled: Mapped[Optional[bool]] = mapped_column(Boolean, server_default="true")
