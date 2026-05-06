from __future__ import annotations

from crate.db.queries.browse_artist_filters import (
    get_browse_filter_countries,
    get_browse_filter_decades,
    get_browse_filter_formats,
    get_browse_filter_genres,
)
from crate.db.queries.browse_artist_genres import (
    get_all_artist_genre_map,
    get_all_artist_genre_map_for_shows,
    get_artist_genre_profile,
    get_artist_genres_by_name,
    get_artist_list_genres,
    get_artist_list_genres_map,
    get_artist_top_genres,
)
from crate.db.queries.browse_artist_listing import (
    get_artists_count,
    get_artists_page,
)
from crate.db.queries.browse_artist_refs import (
    check_artists_in_library,
    get_artist_refs_by_names_full,
    get_similar_artist_refs,
)
from crate.db.queries.browse_artist_tracks import (
    get_artist_all_tracks,
    get_artist_setlist_tracks,
    get_artist_track_titles_with_albums,
)


__all__ = [
    "check_artists_in_library",
    "get_all_artist_genre_map",
    "get_all_artist_genre_map_for_shows",
    "get_artist_all_tracks",
    "get_artist_genre_profile",
    "get_artist_genres_by_name",
    "get_artist_list_genres",
    "get_artist_list_genres_map",
    "get_artist_refs_by_names_full",
    "get_artist_setlist_tracks",
    "get_artist_top_genres",
    "get_artist_track_titles_with_albums",
    "get_artists_count",
    "get_artists_page",
    "get_browse_filter_countries",
    "get_browse_filter_decades",
    "get_browse_filter_formats",
    "get_browse_filter_genres",
    "get_similar_artist_refs",
]
