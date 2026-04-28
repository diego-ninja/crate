"""Playlist update and deletion helpers."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from crate.db.orm.playlist import Playlist
from crate.db.repositories.playlists_shared import emit_playlist_domain_event
from crate.db.tx import optional_scope


def update_playlist(playlist_id: int, *, session: Session | None = None, **kwargs) -> bool:
    def impl(s: Session) -> bool:
        playlist = s.get(Playlist, playlist_id)
        if playlist is None:
            return False
        playlist.updated_at = datetime.now(timezone.utc)
        simple_fields = {
            "name": "name",
            "description": "description",
            "cover_data_url": "cover_data_url",
            "cover_path": "cover_path",
            "scope": "scope",
            "visibility": "visibility",
            "is_collaborative": "is_collaborative",
            "generation_mode": "generation_mode",
            "auto_refresh_enabled": "auto_refresh_enabled",
            "is_curated": "is_curated",
            "is_active": "is_active",
            "managed_by_user_id": "managed_by_user_id",
            "curation_key": "curation_key",
            "featured_rank": "featured_rank",
            "category": "category",
        }
        for key, attr in simple_fields.items():
            if key in kwargs:
                setattr(playlist, attr, kwargs[key])
        if "is_smart" in kwargs:
            playlist.is_smart = kwargs["is_smart"]
        if "smart_rules" in kwargs:
            playlist.smart_rules_json = kwargs["smart_rules"]
        emit_playlist_domain_event(
            s,
            playlist_id=playlist_id,
            action="updated",
            payload={"updated_fields": sorted(kwargs.keys())},
        )
        return True

    with optional_scope(session) as s:
        return impl(s)


def delete_playlist(playlist_id: int, *, session: Session | None = None) -> bool:
    def impl(s: Session) -> bool:
        playlist = s.get(Playlist, playlist_id)
        if playlist is None:
            return False
        emit_playlist_domain_event(s, playlist_id=playlist_id, action="deleted")
        s.delete(playlist)
        return True

    with optional_scope(session) as s:
        return impl(s)


__all__ = ["delete_playlist", "update_playlist"]
