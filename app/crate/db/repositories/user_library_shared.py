from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from sqlalchemy import text

from crate.config import load_config
from crate.db.domain_events import append_domain_event
from crate.db.tx import transaction_scope

_STATS_WINDOWS: dict[str, int | None] = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
    "365d": 365,
    "all_time": None,
}


@lru_cache(maxsize=1)
def library_root() -> Path:
    try:
        return Path(load_config()["library_path"])
    except Exception:
        return Path("/music")


def relative_track_path(track_path: str) -> str:
    if not track_path:
        return ""

    root = str(library_root()).rstrip("/")
    normalized = track_path.strip()
    if root and normalized.startswith(f"{root}/"):
        return normalized[len(root) + 1 :]
    if normalized.startswith("/music/"):
        return normalized[len("/music/") :]
    if not normalized.startswith("/"):
        return normalized
    return ""


@lru_cache(maxsize=1)
def has_legacy_stream_id_column() -> bool:
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'library_tracks'
                  AND column_name = 'navidrome_id'
                LIMIT 1
                """
            )
        ).mappings().first()
    return row is not None


def resolve_track_id(
    session,
    track_id: int | None = None,
    track_path: str | None = None,
    track_storage_id: str | None = None,
) -> int | None:
    if track_id is not None:
        row = session.execute(
            text("SELECT id FROM library_tracks WHERE id = :track_id"),
            {"track_id": track_id},
        ).mappings().first()
        if row:
            return row["id"]

    if track_storage_id:
        row = session.execute(
            text("SELECT id FROM library_tracks WHERE storage_id = :storage_id"),
            {"storage_id": track_storage_id},
        ).mappings().first()
        if row:
            return row["id"]

    if not track_path:
        return None

    rel_path = relative_track_path(track_path)
    root = str(library_root()).rstrip("/")
    absolute_candidate = f"{root}/{rel_path}" if root and rel_path else track_path
    music_candidate = f"/music/{rel_path}" if rel_path else track_path

    should_match_external_id = "/" not in track_path and "\\" not in track_path
    if should_match_external_id and has_legacy_stream_id_column():
        row = session.execute(
            text(
                """
                SELECT id
                FROM library_tracks
                WHERE path = :track_path
                   OR path = :absolute_candidate
                   OR path = :music_candidate
                   OR navidrome_id = :navidrome_id
                ORDER BY CASE
                    WHEN path = :track_path2 THEN 0
                    WHEN path = :absolute_candidate2 THEN 1
                    WHEN path = :music_candidate2 THEN 2
                    ELSE 3
                END
                LIMIT 1
                """
            ),
            {
                "track_path": track_path,
                "absolute_candidate": absolute_candidate,
                "music_candidate": music_candidate,
                "navidrome_id": track_path,
                "track_path2": track_path,
                "absolute_candidate2": absolute_candidate,
                "music_candidate2": music_candidate,
            },
        ).mappings().first()
    else:
        row = session.execute(
            text(
                """
                SELECT id
                FROM library_tracks
                WHERE path = :track_path
                   OR path = :absolute_candidate
                   OR path = :music_candidate
                ORDER BY CASE
                    WHEN path = :track_path2 THEN 0
                    WHEN path = :absolute_candidate2 THEN 1
                    WHEN path = :music_candidate2 THEN 2
                    ELSE 3
                END
                LIMIT 1
                """
            ),
            {
                "track_path": track_path,
                "absolute_candidate": absolute_candidate,
                "music_candidate": music_candidate,
                "track_path2": track_path,
                "absolute_candidate2": absolute_candidate,
                "music_candidate2": music_candidate,
            },
        ).mappings().first()
    return row["id"] if row else None


def emit_user_domain_event(session, *, event_type: str, user_id: int, payload: dict | None = None) -> None:
    append_domain_event(
        event_type,
        {"user_id": user_id, **(payload or {})},
        scope="user",
        subject_key=str(user_id),
        session=session,
    )


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


__all__ = [
    "_STATS_WINDOWS",
    "emit_user_domain_event",
    "has_legacy_stream_id_column",
    "library_root",
    "relative_track_path",
    "resolve_track_id",
    "utc_now_iso",
]
