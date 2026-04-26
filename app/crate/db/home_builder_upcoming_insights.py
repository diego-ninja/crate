from __future__ import annotations

from datetime import datetime, timezone

from crate.db.home_builder_shared import _coerce_date


def _build_upcoming_insights_home(user_id: int, shows: list[dict], attending_show_ids: set[int]) -> list[dict]:
    from crate.db.queries.shows import get_show_reminders
    from crate.db.queries.user_library import get_top_artists

    if not shows:
        return []

    reminders = get_show_reminders(user_id, [show["id"] for show in shows if show.get("id") is not None])
    reminder_keys = {(row["show_id"], row["reminder_type"]) for row in reminders}
    hot_artists = {
        row["artist_name"]
        for row in get_top_artists(user_id, window="30d", limit=12)
        if row.get("artist_name")
    }

    today = datetime.now(timezone.utc).date()
    insights: list[dict] = []
    sortable_shows = [(show, _coerce_date(show.get("date")) or today) for show in shows]
    sortable_shows.sort(key=lambda pair: pair[1])
    for show, show_date in sortable_shows:
        show_id = show.get("id")
        if not show_id or show_id not in attending_show_ids:
            continue

        if _coerce_date(show.get("date")) is None:
            continue

        date_str = show_date.isoformat()
        days_until = (show_date - today).days
        artist_name = show.get("artist_name") or ""
        has_setlist = bool(show.get("probable_setlist"))

        if 7 < days_until <= 30 and (show_id, "one_month") not in reminder_keys:
            insights.append(
                {
                    "type": "one_month",
                    "show_id": show_id,
                    "artist": artist_name,
                    "artist_id": show.get("artist_id"),
                    "artist_slug": show.get("artist_slug"),
                    "date": date_str,
                    "title": show.get("venue") or artist_name,
                    "subtitle": f"{days_until} days to go",
                    "message": f"{artist_name} is coming up in about a month.",
                    "has_setlist": has_setlist,
                }
            )

        if 1 < days_until <= 7 and (show_id, "one_week") not in reminder_keys:
            insights.append(
                {
                    "type": "one_week",
                    "show_id": show_id,
                    "artist": artist_name,
                    "artist_id": show.get("artist_id"),
                    "artist_slug": show.get("artist_slug"),
                    "date": date_str,
                    "title": show.get("venue") or artist_name,
                    "subtitle": f"{days_until} days to go",
                    "message": f"{artist_name} is coming up this week.",
                    "has_setlist": has_setlist,
                }
            )

        if has_setlist and days_until <= 30 and (show_id, "show_prep") not in reminder_keys:
            insights.append(
                {
                    "type": "show_prep",
                    "show_id": show_id,
                    "artist": artist_name,
                    "artist_id": show.get("artist_id"),
                    "artist_slug": show.get("artist_slug"),
                    "date": date_str,
                    "title": f"{artist_name} probable setlist",
                    "subtitle": "Show prep",
                    "message": "Warm up with the likely setlist before the show.",
                    "has_setlist": True,
                    "weight": "high" if artist_name in hot_artists else "normal",
                }
            )

    insights.sort(key=lambda item: (item.get("date", ""), item.get("type", "")))
    return insights[:8]


__all__ = ["_build_upcoming_insights_home"]
