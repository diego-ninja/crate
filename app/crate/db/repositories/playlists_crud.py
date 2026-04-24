"""CRUD helpers for playlist repository modules."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.orm.playlist import Playlist, PlaylistMember, PlaylistTrack
from crate.db.repositories.playlists_reads import get_playlist
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

    def _impl(s: Session) -> int:
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
        return _impl(s)


def update_playlist(playlist_id: int, *, session: Session | None = None, **kwargs) -> bool:
    def _impl(s: Session) -> bool:
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
        return _impl(s)


def delete_playlist(playlist_id: int, *, session: Session | None = None) -> bool:
    def _impl(s: Session) -> bool:
        playlist = s.get(Playlist, playlist_id)
        if playlist is None:
            return False
        emit_playlist_domain_event(s, playlist_id=playlist_id, action="deleted")
        s.delete(playlist)
        return True

    with optional_scope(session) as s:
        return _impl(s)


def duplicate_playlist(playlist_id: int, *, session: Session | None = None) -> dict | None:
    def _impl(s: Session) -> dict | None:
        row = s.execute(text("SELECT * FROM playlists WHERE id = :playlist_id"), {"playlist_id": playlist_id}).mappings().first()
        if not row:
            return None

        original = dict(row)
        now = datetime.now(timezone.utc).isoformat()
        duplicated = s.execute(
            text(
                """
                INSERT INTO playlists (
                    name, description, scope, user_id, managed_by_user_id,
                    is_smart, generation_mode, smart_rules_json, is_curated, is_active,
                    category, featured_rank, visibility, auto_refresh_enabled,
                    created_at, updated_at
                )
                VALUES (
                    :name, :description, :scope, :user_id, :managed_by_user_id,
                    :is_smart, :generation_mode, :smart_rules_json, :is_curated, :is_active,
                    :category, :featured_rank, :visibility, :auto_refresh_enabled,
                    :created_at, :updated_at
                )
                RETURNING id
                """
            ),
            {
                "name": f"{original.get('name', 'Playlist')} (Copy)",
                "description": original.get("description"),
                "scope": original.get("scope", "system"),
                "user_id": original.get("user_id"),
                "managed_by_user_id": original.get("managed_by_user_id"),
                "is_smart": original.get("is_smart", False),
                "generation_mode": original.get("generation_mode", "static"),
                "smart_rules_json": original.get("smart_rules_json"),
                "is_curated": original.get("is_curated", False),
                "is_active": False,
                "category": original.get("category"),
                "featured_rank": None,
                "visibility": original.get("visibility", "public"),
                "auto_refresh_enabled": original.get("auto_refresh_enabled", True),
                "created_at": now,
                "updated_at": now,
            },
        ).mappings().first()
        if not duplicated:
            return None

        new_id = int(duplicated["id"])
        if original.get("generation_mode") != "smart":
            s.execute(
                text(
                    """
                    INSERT INTO playlist_tracks (
                        playlist_id, track_id, track_path, track_storage_id,
                        title, artist, album, duration, position, added_at
                    )
                    SELECT
                        :new_id, track_id, track_path, track_storage_id,
                        title, artist, album, duration, position, :added_at
                    FROM playlist_tracks
                    WHERE playlist_id = :old_id
                    ORDER BY position
                    """
                ),
                {"new_id": new_id, "old_id": playlist_id, "added_at": now},
            )
        emit_playlist_domain_event(
            s,
            playlist_id=new_id,
            action="duplicated",
            payload={"source_playlist_id": playlist_id},
        )
        s.execute(
            text(
                """
                UPDATE playlists
                SET track_count = (
                        SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = :playlist_id
                    ),
                    total_duration = (
                        SELECT COALESCE(SUM(duration), 0) FROM playlist_tracks WHERE playlist_id = :playlist_id
                    )
                WHERE id = :playlist_id
                """
            ),
            {"playlist_id": new_id},
        )

        return get_playlist(new_id, session=s)

    with optional_scope(session) as s:
        return _impl(s)


__all__ = ["create_playlist", "delete_playlist", "duplicate_playlist", "update_playlist"]
