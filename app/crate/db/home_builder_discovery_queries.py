from __future__ import annotations

from crate.db.home_builder_shared import _daily_rotation_index, _trim_bio
from crate.db.queries.home import (
    get_artist_genres_map,
    get_discovery_track_rows,
    get_home_hero_rows,
    get_recent_interest_track_rows,
    get_track_candidates_for_album_ids,
)
from crate.genre_taxonomy import expand_genre_terms_with_aliases


def get_home_hero(
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


def track_candidates_for_album_ids(user_id: int, album_ids: list[int], limit: int = 240) -> list[dict]:
    return get_track_candidates_for_album_ids(album_ids, limit)


def query_discovery_tracks(
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


def fallback_recent_interest_tracks(user_id: int, interest_artists_lower: list[str], limit: int = 240) -> list[dict]:
    return get_recent_interest_track_rows(interest_artists_lower, limit)


__all__ = [
    "fallback_recent_interest_tracks",
    "get_home_hero",
    "query_discovery_tracks",
    "track_candidates_for_album_ids",
]
