import datetime as dt
from datetime import datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from crate.db.engine import Base


class NewRelease(Base):
    __tablename__ = "new_releases"
    __table_args__ = (
        UniqueConstraint("artist_name", "album_title"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    artist_name: Mapped[str] = mapped_column(Text, nullable=False)
    album_title: Mapped[str] = mapped_column(Text, nullable=False)
    tidal_id: Mapped[Optional[str]] = mapped_column(Text)
    tidal_url: Mapped[Optional[str]] = mapped_column(Text)
    cover_url: Mapped[Optional[str]] = mapped_column(Text)
    year: Mapped[Optional[str]] = mapped_column(Text)
    tracks: Mapped[Optional[int]] = mapped_column(Integer)
    quality: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="detected")
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    downloaded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    release_date: Mapped[Optional[dt.date]] = mapped_column(Date)
    release_type: Mapped[Optional[str]] = mapped_column(Text, server_default="Album")
    mb_release_group_id: Mapped[Optional[str]] = mapped_column(Text)
