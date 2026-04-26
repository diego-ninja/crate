from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.user_library_shared import normalize_stats_window, window_day_cutoff
from crate.db.tx import read_scope


def get_stats_trend_points(user_id: int, *, day_cutoff: str | None) -> list[dict]:
    with read_scope() as session:
        if day_cutoff is None:
            rows = session.execute(
                text(
                    """
                    SELECT day, play_count, complete_play_count, skip_count, minutes_listened
                    FROM user_daily_listening
                    WHERE user_id = :user_id
                    ORDER BY day ASC
                    """
                ),
                {"user_id": user_id},
            ).mappings().all()
        else:
            rows = session.execute(
                text(
                    """
                    SELECT day, play_count, complete_play_count, skip_count, minutes_listened
                    FROM user_daily_listening
                    WHERE user_id = :user_id AND day >= :day_cutoff
                    ORDER BY day ASC
                    """
                ),
                {"user_id": user_id, "day_cutoff": day_cutoff},
            ).mappings().all()
    return [dict(row) for row in rows]


def get_stats_trends(user_id: int, window: str = "30d") -> dict:
    normalized = normalize_stats_window(window)
    day_cutoff = window_day_cutoff(normalized)
    return {"window": normalized, "points": get_stats_trend_points(user_id, day_cutoff=day_cutoff)}


__all__ = [
    "get_stats_trend_points",
    "get_stats_trends",
]
