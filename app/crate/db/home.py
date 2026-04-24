"""Home discovery facade.

This module keeps the public home API stable while the implementation is split
across cache/context/surface modules.
"""

from crate.db.home_cache import _get_or_compute_home_cache
from crate.db.home_context import _derive_home_genres
from crate.db.home_surfaces import (
    get_cached_home_discovery,
    get_home_discovery,
    get_home_essentials,
    get_home_favorite_artists,
    get_home_hero,
    get_home_mix,
    get_home_mixes,
    get_home_playlist,
    get_home_radio_stations,
    get_home_recommended_tracks,
    get_home_recently_played,
    get_home_section,
    get_home_suggested_albums,
)
from crate.db.queries.home import get_followed_artist_genre_names
from crate.db.queries.user_library import (
    get_followed_artists,
    get_saved_albums,
    get_top_albums,
    get_top_artists,
    get_top_genres,
)


def _get_home_context(
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


def _get_cached_home_context(
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
        compute=lambda: _get_home_context(
            user_id,
            top_artist_limit=top_artist_limit,
            top_album_limit=top_album_limit,
            top_genre_limit=top_genre_limit,
        ),
    )


__all__ = [
    "_get_cached_home_context",
    "_get_home_context",
    "_get_or_compute_home_cache",
    "get_cached_home_discovery",
    "get_followed_artist_genre_names",
    "get_followed_artists",
    "get_home_discovery",
    "get_home_essentials",
    "get_home_favorite_artists",
    "get_home_hero",
    "get_home_mix",
    "get_home_mixes",
    "get_home_playlist",
    "get_home_radio_stations",
    "get_home_recommended_tracks",
    "get_home_recently_played",
    "get_home_section",
    "get_home_suggested_albums",
    "get_saved_albums",
    "get_top_albums",
    "get_top_artists",
    "get_top_genres",
]
