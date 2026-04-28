"""Playlist duplication helpers."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.repositories.playlists_reads import get_playlist
from crate.db.repositories.playlists_shared import emit_playlist_domain_event
from crate.db.tx import optional_scope


def duplicate_playlist(playlist_id: int, *, session: Session | None = None) -> dict | None:
    def impl(s: Session) -> dict | None:
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
        return impl(s)


__all__ = ["duplicate_playlist"]
