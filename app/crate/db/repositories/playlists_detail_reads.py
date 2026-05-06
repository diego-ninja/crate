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
                    pt.id,
                    pt.playlist_id,
                    COALESCE(lt.id, pt.track_id) AS track_id,
                    COALESCE(lt.entity_uid::text, pt.track_entity_uid::text) AS track_entity_uid,
                    COALESCE(lt.storage_id::text, pt.track_storage_id::text) AS track_storage_id,
                    COALESCE(lt.path, pt.track_path) AS track_path,
                    COALESCE(lt.title, NULLIF(pt.title, ''), lt.filename, 'Unknown') AS title,
                    COALESCE(lt.artist, NULLIF(pt.artist, ''), '') AS artist,
                    COALESCE(lt.album, NULLIF(pt.album, ''), '') AS album,
                    CASE
                        WHEN COALESCE(pt.duration, 0) > 0 THEN pt.duration
                        ELSE COALESCE(lt.duration, pt.duration, 0)
                    END AS duration,
                    lt.bpm,
                    lt.audio_key,
                    lt.audio_scale,
                    lt.energy,
                    lt.danceability,
                    lt.valence,
                    lt.bliss_vector,
                    pt.position,
                    pt.added_at,
                    ar.id AS artist_id,
                    ar.entity_uid::text AS artist_entity_uid,
                    ar.slug AS artist_slug,
                    alb.id AS album_id,
                    alb.entity_uid::text AS album_entity_uid,
                    alb.slug AS album_slug
                FROM (
                    SELECT
                        pt.*,
                        COALESCE(lt_id.id, lt_entity.id, lt_storage.id, lt_path.id) AS resolved_track_id
                    FROM playlist_tracks pt
                    LEFT JOIN library_tracks lt_id
                      ON lt_id.id = pt.track_id
                    LEFT JOIN library_tracks lt_entity
                      ON lt_id.id IS NULL
                     AND pt.track_entity_uid IS NOT NULL
                     AND lt_entity.entity_uid = pt.track_entity_uid
                    LEFT JOIN library_tracks lt_storage
                      ON lt_id.id IS NULL
                     AND lt_entity.id IS NULL
                     AND pt.track_storage_id IS NOT NULL
                     AND lt_storage.storage_id = pt.track_storage_id
                    LEFT JOIN library_tracks lt_path
                      ON lt_id.id IS NULL
                     AND lt_entity.id IS NULL
                     AND lt_storage.id IS NULL
                     AND pt.track_path IS NOT NULL
                     AND lt_path.path = pt.track_path
                    WHERE pt.playlist_id = :playlist_id
                ) pt
                JOIN library_tracks lt
                  ON lt.id = pt.resolved_track_id
                 AND (lt.entity_uid IS NOT NULL OR lt.storage_id IS NOT NULL)
                LEFT JOIN library_albums alb
                  ON alb.id = lt.album_id
                  OR (lt.album_id IS NULL AND alb.artist = COALESCE(lt.artist, pt.artist) AND alb.name = COALESCE(lt.album, pt.album))
                LEFT JOIN library_artists ar ON ar.name = COALESCE(lt.artist, pt.artist)
                ORDER BY pt.position
                """
            ),
            {"playlist_id": playlist_id},
        ).mappings().all()
        tracks = [dict(row) for row in rows]
        for track in tracks:
            bliss_vector = track.get("bliss_vector")
            if bliss_vector is not None:
                track["bliss_vector"] = list(bliss_vector)
        return tracks

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
