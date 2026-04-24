"""Snapshot-backed read helpers for analytics surfaces."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from crate.db.ui_snapshot_store import get_ui_snapshot, mark_ui_snapshots_stale, upsert_ui_snapshot
from crate.db.tx import optional_scope, read_scope

QUALITY_SNAPSHOT_SCOPE = "analytics:quality"
MISSING_SNAPSHOT_SCOPE = "analytics:missing"


def _decorate_snapshot(row: dict[str, Any], *, stale: bool = False) -> dict[str, Any]:
    payload = row.get("payload_json") or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            payload = {}
    if not isinstance(payload, dict):
        payload = {"value": payload}
    data = dict(payload)
    data["snapshot"] = {
        "scope": row.get("scope"),
        "subject_key": row.get("subject_key"),
        "version": int(row.get("version") or 1),
        "built_at": row.get("built_at"),
        "source_seq": int(row.get("source_seq") or 0),
        "stale_after": row.get("stale_after"),
        "stale": stale,
        "generation_ms": int(row.get("generation_ms") or 0),
    }
    return data


def empty_quality_report(*, computing: bool = False, task_id: str | None = None) -> dict[str, Any]:
    return {
        "ready": False,
        "computing": computing,
        "task_id": task_id,
        "corrupt_count": 0,
        "low_bitrate_count": 0,
        "lossy_with_lossless_count": 0,
        "mixed_format_count": 0,
        "corrupt": [],
        "low_bitrate": [],
        "lossy_with_lossless": [],
        "mixed_format_albums": [],
    }


def get_cached_quality_report(*, max_age_seconds: int | None = None) -> dict[str, Any] | None:
    row = get_ui_snapshot(
        QUALITY_SNAPSHOT_SCOPE,
        "global",
        max_age_seconds=max_age_seconds,
    )
    return _decorate_snapshot(row) if row else None


def save_quality_report_snapshot(
    payload: dict[str, Any],
    *,
    generation_ms: int = 0,
    session=None,
) -> dict[str, Any]:
    saved = upsert_ui_snapshot(
        QUALITY_SNAPSHOT_SCOPE,
        "global",
        dict(payload),
        generation_ms=generation_ms,
        stale_after_seconds=86400,
        session=session,
    )
    return _decorate_snapshot(saved)


def mark_quality_report_stale(*, session=None) -> int:
    return mark_ui_snapshots_stale(
        scope=QUALITY_SNAPSHOT_SCOPE,
        subject_key="global",
        session=session,
    )


def resolve_missing_artist(query: str) -> dict[str, Any] | None:
    normalized = (query or "").strip()
    if not normalized:
        return None

    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT id, name, slug, folder_name
                FROM library_artists
                WHERE LOWER(name) = LOWER(:query)
                   OR LOWER(folder_name) = LOWER(:query)
                   OR LOWER(name) LIKE LOWER(:prefix)
                ORDER BY
                    CASE
                        WHEN LOWER(name) = LOWER(:query) THEN 0
                        WHEN LOWER(folder_name) = LOWER(:query) THEN 1
                        WHEN LOWER(name) LIKE LOWER(:prefix) THEN 2
                        ELSE 3
                    END,
                    album_count DESC NULLS LAST,
                    track_count DESC NULLS LAST,
                    name ASC
                LIMIT 1
                """
            ),
            {"query": normalized, "prefix": f"{normalized}%"},
        ).mappings().first()
    return dict(row) if row else None


def get_missing_artist_by_id(artist_id: int) -> dict[str, Any] | None:
    with read_scope() as session:
        row = session.execute(
            text("SELECT id, name, slug, folder_name FROM library_artists WHERE id = :artist_id"),
            {"artist_id": int(artist_id)},
        ).mappings().first()
    return dict(row) if row else None


def list_local_albums_for_missing(artist_id: int) -> list[dict[str, Any]]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    a.id,
                    a.name,
                    COALESCE(NULLIF(a.tag_album, ''), a.name) AS album_tag,
                    a.musicbrainz_albumid AS mbid,
                    a.track_count,
                    a.year,
                    ROUND(COALESCE(a.total_size, 0) / 1048576.0, 1) AS size_mb,
                    COALESCE(a.formats_json ->> 0, '') AS format
                FROM library_albums a
                JOIN library_artists ar ON LOWER(ar.name) = LOWER(a.artist)
                WHERE ar.id = :artist_id
                  AND a.quarantined_at IS NULL
                ORDER BY a.year NULLS LAST, a.name
                """
            ),
            {"artist_id": int(artist_id)},
        ).mappings().all()
    return [dict(row) for row in rows]


def missing_snapshot_subject_key(artist_id: int) -> str:
    return f"artist:{int(artist_id)}"


def empty_missing_report(
    *,
    artist: str,
    artist_id: int | None = None,
    local: list[dict[str, Any]] | None = None,
    computing: bool = False,
    task_id: str | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    local_albums = list(local or [])
    return {
        "ready": False,
        "computing": computing,
        "task_id": task_id,
        "artist": artist,
        "artist_id": artist_id,
        "local_count": len(local_albums),
        "mb_count": 0,
        "missing_count": 0,
        "local": local_albums,
        "missing": [],
        "error": error,
    }


def get_cached_missing_report(artist_id: int, *, max_age_seconds: int | None = None) -> dict[str, Any] | None:
    row = get_ui_snapshot(
        MISSING_SNAPSHOT_SCOPE,
        missing_snapshot_subject_key(artist_id),
        max_age_seconds=max_age_seconds,
    )
    return _decorate_snapshot(row) if row else None


def save_missing_report_snapshot(
    artist_id: int,
    payload: dict[str, Any],
    *,
    generation_ms: int = 0,
    session=None,
) -> dict[str, Any]:
    saved = upsert_ui_snapshot(
        MISSING_SNAPSHOT_SCOPE,
        missing_snapshot_subject_key(artist_id),
        dict(payload),
        generation_ms=generation_ms,
        stale_after_seconds=86400,
        session=session,
    )
    return _decorate_snapshot(saved)


def mark_missing_reports_stale(*, session=None) -> int:
    return mark_ui_snapshots_stale(scope=MISSING_SNAPSHOT_SCOPE, session=session)


def invalidate_analytics_surfaces(*, session=None) -> None:
    with optional_scope(session) as managed:
        mark_quality_report_stale(session=managed)
        mark_missing_reports_stale(session=managed)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
