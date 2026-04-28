"""Playlist creation helpers."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from crate.db.orm.playlist import Playlist, PlaylistMember
from crate.db.repositories.playlists_shared import emit_playlist_domain_event
from crate.db.tx import optional_scope


def create_playlist(
    name: str,
    description: str = "",
    user_id: int | None = None,
    is_smart: bool = False,
    smart_rules: dict | None = None,
    cover_data_url: str | None = None,
    cover_path: str | None = None,
    scope: str | None = None,
    visibility: str | None = None,
    is_collaborative: bool = False,
    generation_mode: str | None = None,
    is_curated: bool = False,
    is_active: bool = True,
    managed_by_user_id: int | None = None,
    curation_key: str | None = None,
    featured_rank: int | None = None,
    category: str | None = None,
    *,
    session: Session | None = None,
) -> int:
    now = datetime.now(timezone.utc)
    final_scope = scope or ("system" if user_id is None else "user")
    final_visibility = visibility or ("public" if final_scope == "system" else "private")
    final_generation_mode = generation_mode or ("smart" if is_smart else "static")

    def impl(s: Session) -> int:
        playlist = Playlist(
            name=name,
            description=description,
            cover_data_url=cover_data_url,
            cover_path=cover_path,
            user_id=user_id,
            is_smart=is_smart,
            smart_rules_json=smart_rules,
            scope=final_scope,
            visibility=final_visibility,
            is_collaborative=is_collaborative,
            generation_mode=final_generation_mode,
            is_curated=is_curated,
            is_active=is_active,
            managed_by_user_id=managed_by_user_id,
            curation_key=curation_key,
            featured_rank=featured_rank,
            category=category,
            created_at=now,
            updated_at=now,
        )
        s.add(playlist)
        s.flush()
        if user_id is not None:
            s.merge(
                PlaylistMember(
                    playlist_id=playlist.id,
                    user_id=user_id,
                    role="owner",
                    invited_by=user_id,
                    created_at=now,
                )
            )
        playlist_id = int(playlist.id)
        emit_playlist_domain_event(
            s,
            playlist_id=playlist_id,
            action="created",
            payload={"scope": final_scope, "user_id": user_id},
        )
        return playlist_id

    with optional_scope(session) as s:
        return impl(s)


__all__ = ["create_playlist"]
