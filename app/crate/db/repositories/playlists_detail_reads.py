"""Detail and history read helpers for playlists."""

from __future__ import annotations

import json

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope


def get_playlist_tracks(playlist_id: int, *, session: Session | None = None) -> list[dict]:
    def _impl(s: Session) -> list[dict]:
        rows = s.execute(
            text(
                """
                SELECT
                    pt.*,
                    lt.id AS track_id,
                    lt.storage_id::text AS track_storage_id,
                    ar.id AS artist_id,
                    ar.slug AS artist_slug,
                    alb.id AS album_id,
                    alb.slug AS album_slug
                FROM playlist_tracks pt
                LEFT JOIN LATERAL (
                    SELECT id, storage_id::text, path, artist, album, album_id
                    FROM library_tracks lt
                    WHERE lt.id = pt.track_id
                       OR lt.path = pt.track_path
                       OR lt.path LIKE ('%/' || pt.track_path)
                    ORDER BY CASE WHEN lt.id = pt.track_id THEN 0 WHEN lt.path = pt.track_path THEN 1 ELSE 2 END
                    LIMIT 1
                ) lt ON TRUE
                LEFT JOIN library_albums alb
                  ON alb.id = lt.album_id
                  OR (lt.album_id IS NULL AND alb.artist = COALESCE(lt.artist, pt.artist) AND alb.name = COALESCE(lt.album, pt.album))
                LEFT JOIN library_artists ar ON ar.name = COALESCE(lt.artist, pt.artist)
                WHERE pt.playlist_id = :playlist_id
                ORDER BY pt.position
                """
            ),
            {"playlist_id": playlist_id},
        ).mappings().all()
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_playlist_filter_options() -> dict:
    with read_scope() as s:
        formats = [
            row["format"]
            for row in s.execute(
                text("SELECT DISTINCT format FROM library_tracks WHERE format IS NOT NULL AND format != '' ORDER BY format")
            ).mappings().all()
        ]
        keys = [
            row["audio_key"]
            for row in s.execute(
                text(
                    "SELECT DISTINCT audio_key FROM library_tracks WHERE audio_key IS NOT NULL AND audio_key != '' ORDER BY audio_key"
                )
            ).mappings().all()
        ]
        scales = [
            row["audio_scale"]
            for row in s.execute(
                text(
                    "SELECT DISTINCT audio_scale FROM library_tracks WHERE audio_scale IS NOT NULL AND audio_scale != '' ORDER BY audio_scale"
                )
            ).mappings().all()
        ]
        artists = [row["name"] for row in s.execute(text("SELECT name FROM library_artists ORDER BY name")).mappings().all()]
        year_row = s.execute(
            text("SELECT MIN(year) AS min_y, MAX(year) AS max_y FROM library_tracks WHERE year IS NOT NULL AND year != ''")
        ).mappings().first()
        bpm_row = s.execute(
            text("SELECT MIN(bpm) AS min_b, MAX(bpm) AS max_b FROM library_tracks WHERE bpm IS NOT NULL")
        ).mappings().first()

    return {
        "formats": formats,
        "keys": keys,
        "scales": scales,
        "artists": artists,
        "year_range": [year_row["min_y"] or "1960", year_row["max_y"] or "2026"],
        "bpm_range": [int(bpm_row["min_b"] or 60), int(bpm_row["max_b"] or 200)],
    }


def get_generation_history(playlist_id: int, limit: int = 5) -> list[dict]:
    with read_scope() as s:
        rows = s.execute(
            text(
                """
                SELECT *
                FROM playlist_generation_log
                WHERE playlist_id = :playlist_id
                ORDER BY started_at DESC
                LIMIT :limit
                """
            ),
            {"playlist_id": playlist_id, "limit": limit},
        ).mappings().all()
    results: list[dict] = []
    for row in rows:
        item = dict(row)
        snapshot = item.pop("rule_snapshot_json", None)
        item["rule_snapshot"] = snapshot if isinstance(snapshot, dict) else (json.loads(snapshot) if snapshot else None)
        for key in ("started_at", "completed_at"):
            if hasattr(item.get(key), "isoformat"):
                item[key] = item[key].isoformat()
        results.append(item)
    return results


__all__ = [
    "get_generation_history",
    "get_playlist_filter_options",
    "get_playlist_tracks",
]
