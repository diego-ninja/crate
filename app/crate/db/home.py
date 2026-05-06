"""Home discovery facade.

This module keeps the public home API stable while the implementation is split
across cache/context/surface modules.
"""

from crate.db.home_cache import _get_or_compute_home_cache
from crate.db.home_context import get_home_context
from crate.db.home_discovery_surface import (
    get_cached_home_discovery,
    get_home_discovery,
)
from crate.db.home_personalized_sections import (
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
    return get_home_context(
        user_id,
        top_artist_limit=top_artist_limit,
        top_album_limit=top_album_limit,
        top_genre_limit=top_genre_limit,
    )


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
