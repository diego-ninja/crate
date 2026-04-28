from __future__ import annotations

from crate.db.queries.home_catalog import (
    get_artist_genres_map,
    get_followed_artist_genre_names,
    get_home_hero_rows,
    get_library_artist_by_id,
    get_recent_global_artist_rows,
)
from crate.db.queries.home_playlists import get_recent_playlist_rows_with_artwork
from crate.db.queries.home_tracks import (
    get_artist_core_track_rows,
    get_discovery_track_rows,
    get_recent_interest_track_rows,
    get_track_candidates_for_album_ids,
)

__all__ = [
    "get_artist_core_track_rows",
    "get_artist_genres_map",
    "get_discovery_track_rows",
    "get_followed_artist_genre_names",
    "get_home_hero_rows",
    "get_library_artist_by_id",
    "get_recent_global_artist_rows",
    "get_recent_interest_track_rows",
    "get_recent_playlist_rows_with_artwork",
    "get_track_candidates_for_album_ids",
]
