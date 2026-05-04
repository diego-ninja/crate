from __future__ import annotations

from datetime import datetime
from typing import Optional

import uuid

from sqlalchemy import UUID, Boolean, DateTime, Float, ForeignKey, Integer, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column

from crate.db.engine import Base


class Playlist(Base):
    __tablename__ = "playlists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    cover_data_url: Mapped[Optional[str]] = mapped_column(Text)
    cover_path: Mapped[Optional[str]] = mapped_column(Text)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    is_smart: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    smart_rules_json: Mapped[Optional[dict]] = mapped_column(JSON)
    scope: Mapped[Optional[str]] = mapped_column(Text)
    visibility: Mapped[Optional[str]] = mapped_column(Text)
    is_collaborative: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    generation_mode: Mapped[Optional[str]] = mapped_column(Text)
    auto_refresh_enabled: Mapped[Optional[bool]] = mapped_column(Boolean)
    is_curated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    is_active: Mapped[Optional[bool]] = mapped_column(Boolean)
    managed_by_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    curation_key: Mapped[Optional[str]] = mapped_column(Text)
    featured_rank: Mapped[Optional[int]] = mapped_column(Integer)
    category: Mapped[Optional[str]] = mapped_column(Text)
    track_count: Mapped[Optional[int]] = mapped_column(Integer)
    total_duration: Mapped[Optional[float]] = mapped_column(Float)
    generation_status: Mapped[Optional[str]] = mapped_column(Text)
    generation_error: Mapped[Optional[str]] = mapped_column(Text)
    last_generated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PlaylistTrack(Base):
    __tablename__ = "playlist_tracks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    playlist_id: Mapped[int] = mapped_column(Integer, ForeignKey("playlists.id", ondelete="CASCADE"), nullable=False)
    track_id: Mapped[Optional[int]] = mapped_column(Integer)
    track_entity_uid: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    track_storage_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    track_path: Mapped[Optional[str]] = mapped_column(Text)
    title: Mapped[Optional[str]] = mapped_column(Text)
    artist: Mapped[Optional[str]] = mapped_column(Text)
    album: Mapped[Optional[str]] = mapped_column(Text)
    duration: Mapped[Optional[float]] = mapped_column(Float)
    position: Mapped[Optional[int]] = mapped_column(Integer)
    added_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class PlaylistMember(Base):
    __tablename__ = "playlist_members"

    playlist_id: Mapped[int] = mapped_column(Integer, ForeignKey("playlists.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[Optional[str]] = mapped_column(Text)
    invited_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class UserFollowedPlaylist(Base):
    __tablename__ = "user_followed_playlists"

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    playlist_id: Mapped[int] = mapped_column(Integer, ForeignKey("playlists.id", ondelete="CASCADE"), primary_key=True)
    followed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
