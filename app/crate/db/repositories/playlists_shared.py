"""Shared helpers for playlist repository modules."""

from __future__ import annotations

import json

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from crate.db.domain_events import append_domain_event


def playlist_to_dict(playlist) -> dict | None:
    if playlist is None:
        return None

    data = {
        "id": playlist.id,
        "name": playlist.name,
        "description": playlist.description,
        "cover_data_url": playlist.cover_data_url,
        "cover_path": playlist.cover_path,
        "user_id": playlist.user_id,
        "is_smart": bool(playlist.is_smart),
        "smart_rules": playlist.smart_rules_json,
        "scope": playlist.scope or ("system" if playlist.user_id is None else "user"),
        "visibility": playlist.visibility,
        "is_collaborative": bool(playlist.is_collaborative),
        "generation_mode": playlist.generation_mode,
        "auto_refresh_enabled": playlist.auto_refresh_enabled,
        "is_curated": bool(playlist.is_curated),
        "is_active": playlist.is_active,
        "managed_by_user_id": playlist.managed_by_user_id,
        "curation_key": playlist.curation_key,
        "featured_rank": playlist.featured_rank,
        "category": playlist.category,
        "track_count": playlist.track_count,
        "total_duration": playlist.total_duration,
        "generation_status": playlist.generation_status,
        "generation_error": playlist.generation_error,
        "last_generated_at": playlist.last_generated_at.isoformat() if playlist.last_generated_at else None,
        "created_at": playlist.created_at,
        "updated_at": playlist.updated_at,
    }
    data["visibility"] = data["visibility"] or ("public" if data["scope"] == "system" else "private")
    data["generation_mode"] = data["generation_mode"] or ("smart" if data["is_smart"] else "static")
    data["is_active"] = True if data["is_active"] is None else bool(data["is_active"])
    data["auto_refresh_enabled"] = True if data["auto_refresh_enabled"] is None else bool(data["auto_refresh_enabled"])
    data["is_system"] = data["scope"] == "system"
    if data["cover_path"]:
        data["cover_data_url"] = f"/api/playlists/{data['id']}/cover"
    return data


def normalize_playlist_row(row: dict | None) -> dict | None:
    if row is None:
        return None
    data = dict(row)
    rules = data.pop("smart_rules_json", None)
    data["smart_rules"] = rules if isinstance(rules, dict) else (json.loads(rules) if rules else None)
    data["scope"] = data.get("scope") or ("system" if data.get("user_id") is None else "user")
    data["generation_mode"] = data.get("generation_mode") or ("smart" if data.get("is_smart") else "static")
    data["is_curated"] = bool(data.get("is_curated"))
    data["is_active"] = True if data.get("is_active") is None else bool(data.get("is_active"))
    data["visibility"] = data.get("visibility") or ("public" if data["scope"] == "system" else "private")
    data["is_collaborative"] = bool(data.get("is_collaborative"))
    data["is_system"] = data["scope"] == "system"
    data["auto_refresh_enabled"] = True if data.get("auto_refresh_enabled") is None else bool(data.get("auto_refresh_enabled"))
    data["generation_status"] = data.get("generation_status") or "idle"
    data["generation_error"] = data.get("generation_error")
    if hasattr(data.get("last_generated_at"), "isoformat"):
        data["last_generated_at"] = data["last_generated_at"].isoformat()
    if data.get("cover_path"):
        data["cover_data_url"] = f"/api/playlists/{data['id']}/cover"
    return data


def fetch_artwork_tracks_for_playlists(session: Session, playlist_ids: list[int]) -> dict[int, list[dict]]:
    if not playlist_ids:
        return {}
    rows = session.execute(
        text(
            """
            WITH artwork_groups AS (
                SELECT
                    pt.playlist_id,
                    COALESCE(lt.artist, pt.artist) AS artist,
                    ar.id AS artist_id,
                    ar.entity_uid::text AS artist_entity_uid,
                    ar.slug AS artist_slug,
                    COALESCE(lt.album, pt.album) AS album,
                    alb.id AS album_id,
                    alb.entity_uid::text AS album_entity_uid,
                    alb.slug AS album_slug
                FROM playlist_tracks pt
                LEFT JOIN LATERAL (
                    SELECT id, entity_uid::text, path, artist, album, album_id
                    FROM library_tracks lt
                    WHERE lt.id = pt.track_id
                       OR (pt.track_entity_uid IS NOT NULL AND lt.entity_uid = pt.track_entity_uid)
                       OR (pt.track_storage_id IS NOT NULL AND lt.storage_id = pt.track_storage_id)
                       OR lt.path = pt.track_path
                       OR lt.path LIKE ('%/' || pt.track_path)
                    ORDER BY CASE
                        WHEN lt.id = pt.track_id THEN 0
                        WHEN pt.track_entity_uid IS NOT NULL AND lt.entity_uid = pt.track_entity_uid THEN 1
                        WHEN pt.track_storage_id IS NOT NULL AND lt.storage_id = pt.track_storage_id THEN 2
                        WHEN lt.path = pt.track_path THEN 3
                        ELSE 4
                    END
                    LIMIT 1
                ) lt ON TRUE
                LEFT JOIN library_albums alb
                  ON alb.id = lt.album_id
                  OR (lt.album_id IS NULL AND alb.artist = COALESCE(lt.artist, pt.artist) AND alb.name = COALESCE(lt.album, pt.album))
                LEFT JOIN library_artists ar ON ar.name = COALESCE(lt.artist, pt.artist)
                WHERE pt.playlist_id IN :playlist_ids
                  AND COALESCE(lt.artist, pt.artist, '') != ''
                  AND COALESCE(lt.album, pt.album, '') != ''
                GROUP BY
                    pt.playlist_id,
                    COALESCE(lt.artist, pt.artist),
                    ar.id,
                    ar.entity_uid,
                    ar.slug,
                    COALESCE(lt.album, pt.album),
                    alb.id,
                    alb.entity_uid,
                    alb.slug
            ),
            ranked_artwork AS (
                SELECT
                    playlist_id,
                    artist,
                    artist_id,
                    artist_entity_uid,
                    artist_slug,
                    album,
                    album_id,
                    album_entity_uid,
                    album_slug,
                    ROW_NUMBER() OVER (
                        PARTITION BY playlist_id
                        ORDER BY album, artist
                    ) AS artwork_rank
                FROM artwork_groups
            )
            SELECT
                playlist_id,
                artist,
                artist_id,
                artist_entity_uid,
                artist_slug,
                album,
                album_id,
                album_entity_uid,
                album_slug
            FROM ranked_artwork
            WHERE artwork_rank <= 4
            ORDER BY playlist_id, artwork_rank
            """
        ).bindparams(bindparam("playlist_ids", expanding=True)),
        {"playlist_ids": playlist_ids},
    ).mappings().all()
    artwork_by_playlist = {playlist_id: [] for playlist_id in playlist_ids}
    for row in rows:
        item = dict(row)
        playlist_id = int(item.pop("playlist_id"))
        artwork_by_playlist.setdefault(playlist_id, []).append(item)
    return artwork_by_playlist


def attach_artwork_tracks(session: Session, playlists: list[dict]) -> list[dict]:
    artwork_by_playlist = fetch_artwork_tracks_for_playlists(
        session,
        [int(item["id"]) for item in playlists if item.get("id") is not None],
    )
    for item in playlists:
        item["artwork_tracks"] = artwork_by_playlist.get(int(item["id"]), [])
    return playlists


def emit_playlist_domain_event(
    session: Session,
    *,
    playlist_id: int,
    action: str,
    payload: dict | None = None,
) -> None:
    append_domain_event(
        "playlist.changed",
        {"playlist_id": playlist_id, "action": action, **(payload or {})},
        scope="playlist",
        subject_key=str(playlist_id),
        session=session,
    )


__all__ = [
    "attach_artwork_tracks",
    "emit_playlist_domain_event",
    "fetch_artwork_tracks_for_playlists",
    "normalize_playlist_row",
    "playlist_to_dict",
]
