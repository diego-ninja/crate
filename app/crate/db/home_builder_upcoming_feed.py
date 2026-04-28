from __future__ import annotations

from datetime import datetime, timedelta, timezone

from crate.db.home_builder_shared import _coerce_date
from crate.db.home_builder_upcoming_insights import _build_upcoming_insights_home
from crate.db.queries.user_library import get_followed_artists


def _build_release_items(releases: list[dict], *, today) -> list[dict]:
    items: list[dict] = []
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
    return items


def _load_probable_setlists(artist_names: list[str]) -> dict[str, list[dict]]:
    from crate.db.cache_store import get_cache

    probable_setlists: dict[str, list[dict]] = {}
    for artist_name in artist_names:
        cached = get_cache(f"setlistfm:probable:{artist_name.lower()}", max_age_seconds=86400 * 7)
        songs = cached.get("songs") if isinstance(cached, dict) else None
        if songs:
            probable_setlists[artist_name] = songs
    return probable_setlists


def _build_show_items(
    shows: list[dict],
    *,
    probable_setlists: dict[str, list[dict]],
    attending_show_ids: set[int],
) -> list[dict]:
    items: list[dict] = []
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
    return items


def _build_home_upcoming(user_id: int, *, lookup_limit: int = 120, item_limit: int = 12) -> dict:
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

    now = datetime.now(timezone.utc)
    today = now.date()
    recent_cutoff = (now - timedelta(days=45)).isoformat()
    full_user = get_user_by_id(user_id) or {}
    user_lat = full_user.get("latitude")
    user_lon = full_user.get("longitude")
    user_radius = full_user.get("show_radius_km") or 60

    releases = get_upcoming_releases(followed_names, today, recent_cutoff, lookup_limit)
    items = _build_release_items(releases, today=today)

    shows = get_upcoming_shows(followed_names, today, user_lat, user_lon, user_radius, lookup_limit)
    attending_show_ids = get_attending_show_ids(user_id, [show["id"] for show in shows if show.get("id") is not None])
    show_artists = sorted({show["artist_name"] for show in shows if show.get("artist_name")})
    probable_setlists = _load_probable_setlists(show_artists) if show_artists else {}
    items.extend(
        _build_show_items(
            shows,
            probable_setlists=probable_setlists,
            attending_show_ids=attending_show_ids,
        )
    )

    items.sort(key=lambda item: ((item.get("date") or "9999-12-31"), item.get("artist") or ""))
    insights = _build_upcoming_insights_home(user_id, shows, attending_show_ids)
    show_count = sum(1 for item in items if item.get("type") == "show")
    release_count = sum(1 for item in items if item.get("type") == "release")

    return {
        "items": items[:item_limit],
        "insights": insights,
        "summary": {
            "followed_artists": len(followed_names),
            "show_count": show_count,
            "release_count": release_count,
            "attending_count": len(attending_show_ids),
            "insight_count": len(insights),
        },
    }


__all__ = ["_build_home_upcoming"]
