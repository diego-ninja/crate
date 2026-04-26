"""Generation logging and status helpers for playlists."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import optional_scope


def log_generation_start(playlist_id: int, rules: dict | None, triggered_by: str = "manual") -> int:
    with optional_scope(None) as s:
        row = s.execute(
            text(
                """
                INSERT INTO playlist_generation_log (playlist_id, started_at, status, rule_snapshot_json, triggered_by)
                VALUES (:playlist_id, :started_at, 'running', :rule_snapshot_json, :triggered_by)
                RETURNING id
                """
            ),
            {
                "playlist_id": playlist_id,
                "started_at": datetime.now(timezone.utc).isoformat(),
                "rule_snapshot_json": json.dumps(rules, default=str) if rules else None,
                "triggered_by": triggered_by,
            },
        ).mappings().first()
        return row["id"] if row else 0


def log_generation_complete(log_id: int, track_count: int, duration_sec: int) -> None:
    with optional_scope(None) as s:
        s.execute(
            text(
                """
                UPDATE playlist_generation_log
                SET status = 'completed', completed_at = :completed_at, track_count = :track_count, duration_sec = :duration_sec
                WHERE id = :log_id
                """
            ),
            {
                "log_id": log_id,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "track_count": track_count,
                "duration_sec": duration_sec,
            },
        )


def log_generation_failed(log_id: int, error: str) -> None:
    with optional_scope(None) as s:
        s.execute(
            text(
                """
                UPDATE playlist_generation_log
                SET status = 'failed', completed_at = :completed_at, error = :error
                WHERE id = :log_id
                """
            ),
            {
                "log_id": log_id,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "error": error[:500],
            },
        )


def set_generation_status(playlist_id: int, status: str, error: str | None = None) -> None:
    updates = ["generation_status = :status", "updated_at = :now"]
    params: dict[str, object] = {
        "playlist_id": playlist_id,
        "status": status,
        "now": datetime.now(timezone.utc).isoformat(),
    }
    if status == "idle":
        updates.append("last_generated_at = :now")
        updates.append("generation_error = NULL")
    elif status == "failed" and error:
        updates.append("generation_error = :error")
        params["error"] = error[:500]

    with optional_scope(None) as s:
        s.execute(
            text(f"UPDATE playlists SET {', '.join(updates)} WHERE id = :playlist_id"),
            params,
        )


__all__ = [
    "log_generation_complete",
    "log_generation_failed",
    "log_generation_start",
    "set_generation_status",
]
