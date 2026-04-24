from __future__ import annotations

from datetime import datetime, timedelta, timezone

from crate.db.home_builder_shared import (
    _album_identity,
    _artist_identity,
    _daily_rotation_index,
    _merge_track_rows,
    _select_diverse_tracks_with_backfill,
    _track_payload,
    _trim_bio,
)
from crate.db.queries.home import (
    get_artist_core_track_rows,
    get_artist_genres_map,
    get_discovery_track_rows,
    get_home_hero_rows,
    get_library_artist_by_id,
    get_recent_interest_track_rows,
    get_recent_playlist_rows_with_artwork,
    get_track_candidates_for_album_ids,
)
from crate.db.queries.user_library import get_play_history
from crate.genre_taxonomy import expand_genre_terms_with_aliases


def _build_recently_played(user_id: int, limit: int = 9) -> list[dict]:
    target_per_bucket = max(3, (limit + 2) // 3)
    history = get_play_history(user_id, limit=max(limit * 6, 48))

    recent_artists: list[dict] = []
    recent_albums: list[dict] = []
    seen_artists: set[object] = set()
    seen_albums: set[object] = set()

    for row in history:
        artist_key = _artist_identity(row)
        if artist_key and artist_key not in seen_artists:
            seen_artists.add(artist_key)
            recent_artists.append(
                {
                    "type": "artist",
                    "artist_id": row.get("artist_id"),
                    "artist_slug": row.get("artist_slug"),
                    "artist_name": row.get("artist") or "",
                    "subtitle": "Artist",
                    "played_at": row.get("played_at"),
                }
            )
        album_key = _album_identity(row)
        if row.get("album") and album_key not in seen_albums:
            seen_albums.add(album_key)
            recent_albums.append(
                {
                    "type": "album",
                    "album_id": row.get("album_id"),
                    "album_slug": row.get("album_slug"),
                    "album_name": row.get("album") or "",
                    "artist_name": row.get("artist") or "",
                    "artist_id": row.get("artist_id"),
                    "artist_slug": row.get("artist_slug"),
                    "subtitle": "Album",
                    "played_at": row.get("played_at"),
                }
            )
        if len(recent_artists) >= target_per_bucket and len(recent_albums) >= target_per_bucket:
            break

    recent_playlists = get_recent_playlist_rows_with_artwork(user_id, target_per_bucket)

    items: list[dict] = []
    for index in range(target_per_bucket):
        if index < len(recent_playlists):
            items.append(recent_playlists[index])
        if index < len(recent_artists):
            items.append(recent_artists[index])
        if index < len(recent_albums):
            items.append(recent_albums[index])
    return items[:limit]


def _get_home_hero(
    user_id: int,
    followed_names_lower: list[str],
    similar_target_names_lower: list[str],
    top_genres_lower: list[str],
) -> dict | None:
    rows = get_home_hero_rows(
        followed_names_lower=followed_names_lower,
        similar_target_names_lower=similar_target_names_lower,
        top_genres_lower=top_genres_lower,
    )
    if not rows:
        return None

    artist_names = [row["name"] for row in rows]
    genre_map = get_artist_genres_map(artist_names)

    for item in rows:
        item["bio"] = _trim_bio(item.get("bio") or "")
        item["genres"] = genre_map.get(item["name"], [])[:4]

    offset = _daily_rotation_index(len(rows), user_id)
    return rows[offset:] + rows[:offset]


def _track_candidates_for_album_ids(user_id: int, album_ids: list[int], limit: int = 240) -> list[dict]:
    return get_track_candidates_for_album_ids(album_ids, limit)


def _query_discovery_tracks(
    user_id: int,
    *,
    genres: list[str],
    excluded_artist_names: list[str],
    limit: int = 240,
) -> list[dict]:
    if not genres:
        return []
    genres = expand_genre_terms_with_aliases(genres)
    return get_discovery_track_rows(
        genres=genres,
        excluded_artist_names=excluded_artist_names,
        limit=limit,
    )


def _filter_interesting_releases(
    releases: list[dict],
    *,
    interest_artists_lower: set[str],
    saved_album_ids: set[int],
    days: int | None = None,
) -> list[dict]:
    from crate.db.home_builder_shared import _coerce_datetime

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


def _fallback_recent_interest_tracks(user_id: int, interest_artists_lower: list[str], limit: int = 240) -> list[dict]:
    return get_recent_interest_track_rows(interest_artists_lower, limit)


def _build_artist_core_rows(
    user_id: int,
    *,
    artist_id: int,
    artist_name: str,
    limit: int,
) -> list[dict]:
    rows = get_artist_core_track_rows(artist_id=artist_id, artist_name=artist_name, limit=limit)
    return _select_diverse_tracks_with_backfill(rows, limit=limit, max_per_artist=limit, max_per_album=2)


def _get_library_artist(artist_id: int) -> dict | None:
    return get_library_artist_by_id(artist_id)


def _build_suggested_albums(recent_releases: list[dict], limit: int) -> list[dict]:
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


def _build_recommended_tracks(
    user_id: int,
    *,
    recent_releases: list[dict],
    interest_artists_lower: list[str],
    limit: int,
    fallback_tracks: list[dict] | None = None,
) -> list[dict]:
    fresh_release_album_ids = [
        row["album_id"]
        for row in _filter_interesting_releases(
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
    recommended_track_rows = _track_candidates_for_album_ids(user_id, fresh_release_album_ids[:24], limit=candidate_limit)
    recommended_track_rows = [
        row for row in recommended_track_rows if not row.get("user_play_count") and not row.get("is_liked")
    ]
    if len(recommended_track_rows) < limit:
        fallback_rows = [dict(track) for track in (fallback_tracks or [])]
        recommended_track_rows = _merge_track_rows(recommended_track_rows, fallback_rows)
    return _select_diverse_tracks_with_backfill(recommended_track_rows, limit=limit, max_per_artist=2, max_per_album=2)


__all__ = [
    "_build_artist_core_rows",
    "_build_recently_played",
    "_build_recommended_tracks",
    "_build_suggested_albums",
    "_fallback_recent_interest_tracks",
    "_filter_interesting_releases",
    "_get_home_hero",
    "_get_library_artist",
    "_query_discovery_tracks",
    "_track_candidates_for_album_ids",
    "_track_payload",
]
