from __future__ import annotations

from datetime import datetime, timedelta, timezone

from crate.db.home_builder_shared import _coerce_datetime, _merge_track_rows, _select_diverse_tracks_with_backfill
from crate.db.home_builder_discovery_queries import track_candidates_for_album_ids


def filter_interesting_releases(
    releases: list[dict],
    *,
    interest_artists_lower: set[str],
    saved_album_ids: set[int],
    days: int | None = None,
) -> list[dict]:
    now = datetime.now(timezone.utc)
    items: list[dict] = []
    seen_album_ids: set[int] = set()
    for row in releases:
        album_id = row.get("album_id")
        artist_name = (row.get("artist_name") or "").strip()
        if not album_id or not artist_name:
            continue
        if album_id in saved_album_ids or album_id in seen_album_ids:
            continue
        if interest_artists_lower and artist_name.lower() not in interest_artists_lower:
            continue
        key_dt = _coerce_datetime(row.get("release_date")) or _coerce_datetime(row.get("detected_at"))
        if days is not None and key_dt and key_dt < now - timedelta(days=days):
            continue
        seen_album_ids.add(album_id)
        items.append(dict(row))
    items.sort(
        key=lambda item: _coerce_datetime(item.get("release_date")) or _coerce_datetime(item.get("detected_at")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return items


def build_suggested_albums(recent_releases: list[dict], limit: int) -> list[dict]:
    suggested_albums: list[dict] = []
    for row in recent_releases:
        suggested_albums.append(
            {
                "album_id": row.get("album_id"),
                "album_slug": row.get("album_slug"),
                "artist_name": row.get("artist_name") or "",
                "artist_id": row.get("artist_id"),
                "artist_slug": row.get("artist_slug"),
                "album_name": row.get("album_title") or "",
                "year": row.get("year"),
                "release_date": row.get("release_date"),
                "release_type": row.get("release_type") or "Album",
            }
        )
        if len(suggested_albums) >= limit:
            break
    return suggested_albums


def build_recommended_tracks(
    user_id: int,
    *,
    recent_releases: list[dict],
    interest_artists_lower: list[str],
    limit: int,
    fallback_tracks: list[dict] | None = None,
) -> list[dict]:
    fresh_release_album_ids = [
        row["album_id"]
        for row in filter_interesting_releases(
            recent_releases,
            interest_artists_lower=set(interest_artists_lower),
            saved_album_ids=set(),
            days=7,
        )
        if row.get("album_id") is not None
    ]
    if not fresh_release_album_ids:
        fresh_release_album_ids = [row["album_id"] for row in recent_releases[:24] if row.get("album_id") is not None]

    candidate_limit = max(limit * 6, 120)
    recommended_track_rows = track_candidates_for_album_ids(user_id, fresh_release_album_ids[:24], limit=candidate_limit)
    recommended_track_rows = [
        row for row in recommended_track_rows if not row.get("user_play_count") and not row.get("is_liked")
    ]
    if len(recommended_track_rows) < limit:
        fallback_rows = [dict(track) for track in (fallback_tracks or [])]
        recommended_track_rows = _merge_track_rows(recommended_track_rows, fallback_rows)
    return _select_diverse_tracks_with_backfill(recommended_track_rows, limit=limit, max_per_artist=2, max_per_album=2)


__all__ = [
    "build_recommended_tracks",
    "build_suggested_albums",
    "filter_interesting_releases",
]
