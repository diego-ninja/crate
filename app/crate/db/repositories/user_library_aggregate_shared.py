from __future__ import annotations

from datetime import datetime, timedelta, timezone


def window_cutoff(days: int | None) -> str | None:
    if days is None:
        return None
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def window_filter_sql(cutoff: str | None) -> tuple[str, dict]:
    if cutoff is None:
        return "upe.user_id = :filter_user_id", {}
    return "upe.user_id = :filter_user_id AND upe.ended_at >= :cutoff", {"cutoff": cutoff}


__all__ = ["window_cutoff", "window_filter_sql"]
