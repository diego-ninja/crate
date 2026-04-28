from __future__ import annotations

from crate.db.home_cache import _get_or_compute_home_cache
from crate.db.queries.home import get_followed_artist_genre_names
from crate.db.queries.user_library import (
    get_followed_artists,
    get_saved_albums,
    get_top_albums,
    get_top_artists,
    get_top_genres,
)
from crate.db.releases import get_new_releases
from crate.genre_taxonomy import choose_mix_seed_genres, summarize_taste_genres


def _genre_stat_rows_from_names(names: list[str]) -> list[dict]:
    return [
        {
            "genre_name": name,
            "play_count": 1,
            "complete_play_count": 0,
            "minutes_listened": 0,
        }
        for name in names
        if (name or "").strip()
    ]


def _derive_home_genres(top_genres: list[dict], fallback_names: list[str], limit: int) -> tuple[list[str], list[dict]]:
    genre_rows = [dict(row) for row in top_genres if row.get("genre_name")]
    taste_genres = summarize_taste_genres(genre_rows, limit=limit)
    mix_seed_genres = choose_mix_seed_genres(genre_rows, limit=limit)
    if taste_genres or mix_seed_genres:
        return taste_genres, mix_seed_genres

    fallback_rows = _genre_stat_rows_from_names(fallback_names)
    return (
        summarize_taste_genres(fallback_rows, limit=limit),
        choose_mix_seed_genres(fallback_rows, limit=limit),
    )


def get_home_context(
    user_id: int,
    *,
    top_artist_limit: int = 28,
    top_album_limit: int = 12,
    top_genre_limit: int = 8,
) -> dict:
    followed = get_followed_artists(user_id)
    saved_albums = get_saved_albums(user_id)
    top_artists = get_top_artists(user_id, window="90d", limit=top_artist_limit)
    top_albums = get_top_albums(user_id, window="90d", limit=top_album_limit)
    top_genres = get_top_genres(user_id, window="90d", limit=top_genre_limit)

    followed_names_lower = [(row.get("artist_name") or "").lower() for row in followed if row.get("artist_name")]
    top_artist_names_lower = [(row.get("artist_name") or "").lower() for row in top_artists if row.get("artist_name")]
    interest_artists_lower = list(dict.fromkeys(top_artist_names_lower + followed_names_lower))
    saved_album_ids = list({row["id"] for row in saved_albums if row.get("id") is not None})
    top_genres_lower, mix_seed_genres = _derive_home_genres(top_genres, [], top_genre_limit)
    if not top_genres_lower and not mix_seed_genres and followed_names_lower:
        fallback_genre_names = get_followed_artist_genre_names(followed_names_lower, top_genre_limit)
        top_genres_lower, mix_seed_genres = _derive_home_genres(top_genres, fallback_genre_names, top_genre_limit)

    return {
        "followed": followed,
        "saved_albums": saved_albums,
        "top_artists": top_artists,
        "top_albums": top_albums,
        "top_genres": top_genres,
        "followed_names_lower": followed_names_lower,
        "top_artist_names_lower": top_artist_names_lower,
        "top_genres_lower": top_genres_lower,
        "mix_seed_genres": mix_seed_genres,
        "interest_artists_lower": interest_artists_lower,
        "saved_album_ids": saved_album_ids,
    }


def get_cached_home_context(
    user_id: int,
    *,
    top_artist_limit: int = 28,
    top_album_limit: int = 12,
    top_genre_limit: int = 8,
) -> dict:
    cache_key = f"home:context:{user_id}:{top_artist_limit}:{top_album_limit}:{top_genre_limit}"
    return _get_or_compute_home_cache(
        cache_key,
        max_age_seconds=600,
        ttl=600,
        compute=lambda: get_home_context(
            user_id,
            top_artist_limit=top_artist_limit,
            top_album_limit=top_album_limit,
            top_genre_limit=top_genre_limit,
        ),
    )


def merged_artists_from_context(context: dict) -> list[dict]:
    top_artists = context["top_artists"]
    followed = context["followed"]
    seen_artist_ids = {row.get("artist_id") for row in top_artists if row.get("artist_id") is not None}
    merged = list(top_artists)
    for row in followed:
        aid = row.get("artist_id")
        if aid is not None and aid not in seen_artist_ids:
            merged.append(
                {
                    "artist_id": aid,
                    "artist_slug": row.get("artist_slug"),
                    "artist_name": row.get("artist_name") or "",
                    "play_count": 0,
                    "minutes_listened": 0,
                }
            )
            seen_artist_ids.add(aid)
    return merged


def recent_releases_from_context(context: dict, *, days: int = 240) -> list[dict]:
    from crate.db.home_builders import _filter_interesting_releases

    return _filter_interesting_releases(
        get_new_releases(limit=250),
        interest_artists_lower=set(context["interest_artists_lower"]),
        saved_album_ids=set(context["saved_album_ids"]),
        days=days,
    )
