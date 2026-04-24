from __future__ import annotations

from datetime import datetime, timedelta, timezone

from crate.db.home_builder_shared import _coerce_date, _coerce_datetime
from crate.db.queries.home import get_recent_global_artist_rows
from crate.db.queries.user_library import get_followed_artists


def _build_recent_global_artists(limit: int = 10) -> list[dict]:
    return [
        {
            "id": row.get("id"),
            "slug": row.get("slug"),
            "name": row.get("name"),
            "album_count": row.get("album_count"),
            "track_count": row.get("track_count"),
            "has_photo": bool(row.get("has_photo")),
        }
        for row in get_recent_global_artist_rows(limit)
        if row.get("name")
    ]


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


def _build_home_upcoming(user_id: int, limit: int = 120) -> dict:
    from crate.db.cache_store import get_cache
    from crate.db.queries.shows import get_attending_show_ids
    from crate.db.queries.user import get_upcoming_releases, get_upcoming_shows
    from crate.db.repositories.auth import get_user_by_id

    followed = get_followed_artists(user_id)
    followed_names = [row["artist_name"] for row in followed if row.get("artist_name")]
    if not followed_names:
        return {
            "items": [],
            "insights": [],
            "summary": {
                "followed_artists": 0,
                "show_count": 0,
                "release_count": 0,
                "attending_count": 0,
                "insight_count": 0,
            },
        }

    today = datetime.now(timezone.utc).date()
    recent_cutoff = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
    full_user = get_user_by_id(user_id) or {}
    user_lat = full_user.get("latitude")
    user_lon = full_user.get("longitude")
    user_radius = full_user.get("show_radius_km") or 60

    items: list[dict] = []

    releases = get_upcoming_releases(followed_names, today, recent_cutoff, limit)
    for release in releases:
        scheduled_date = _coerce_date(release.get("release_date"))
        fallback_date = scheduled_date or _coerce_date(release.get("detected_at"))
        items.append(
            {
                "type": "release",
                "date": fallback_date.isoformat() if fallback_date else "",
                "artist": release.get("artist_name", ""),
                "artist_id": release.get("artist_id"),
                "artist_slug": release.get("artist_slug"),
                "title": release.get("album_title", ""),
                "subtitle": release.get("release_type") or "Album",
                "status": release.get("status", "detected"),
                "release_id": release.get("id"),
                "is_upcoming": bool(scheduled_date and scheduled_date >= today),
            }
        )

    shows = get_upcoming_shows(followed_names, today, user_lat, user_lon, user_radius, limit)
    attending_show_ids = get_attending_show_ids(user_id, [show["id"] for show in shows if show.get("id") is not None])

    show_artists = sorted({show["artist_name"] for show in shows if show.get("artist_name")})
    probable_setlists: dict[str, list[dict]] = {}
    if show_artists:
        for artist_name in show_artists:
            cached = get_cache(f"setlistfm:probable:{artist_name.lower()}", max_age_seconds=86400 * 7)
            songs = cached.get("songs") if isinstance(cached, dict) else None
            if songs:
                probable_setlists[artist_name] = songs

    for show in shows:
        artist_name = show.get("artist_name", "")
        items.append(
            {
                "id": show.get("id"),
                "type": "show",
                "date": show.get("date"),
                "time": show.get("local_time"),
                "artist": artist_name,
                "artist_id": show.get("artist_id"),
                "artist_slug": show.get("artist_slug"),
                "title": show.get("venue", ""),
                "subtitle": ", ".join(part for part in [show.get("city"), show.get("country")] if part),
                "is_upcoming": True,
                "user_attending": show.get("id") in attending_show_ids,
                "probable_setlist": probable_setlists.get(artist_name),
            }
        )

    items.sort(key=lambda item: ((item.get("date") or "9999-12-31"), item.get("artist") or ""))
    insights = _build_upcoming_insights_home(user_id, shows, attending_show_ids)
    show_count = sum(1 for item in items if item.get("type") == "show")
    release_count = sum(1 for item in items if item.get("type") == "release")

    return {
        "items": items[:limit],
        "insights": insights,
        "summary": {
            "followed_artists": len(followed_names),
            "show_count": show_count,
            "release_count": release_count,
            "attending_count": len(attending_show_ids),
            "insight_count": len(insights),
        },
    }


__all__ = [
    "_build_home_upcoming",
    "_build_recent_global_artists",
]
