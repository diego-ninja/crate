"""Database queries for the Subsonic API endpoints."""

from crate.db.queries.subsonic_artist_album_queries import (
    get_album_list,
    get_album_with_artist,
    get_albums_by_artist_name,
    get_all_artists_sorted,
    get_artist_by_id,
)
from crate.db.queries.subsonic_search_queries import search_albums, search_artists, search_tracks
from crate.db.queries.subsonic_track_queries import (
    get_random_tracks,
    get_track_basic,
    get_track_full,
    get_track_path_and_format,
    get_tracks_by_album_id,
)
from crate.db.queries.subsonic_user_queries import get_user_by_username


__all__ = [
    "get_album_list",
    "get_album_with_artist",
    "get_albums_by_artist_name",
    "get_all_artists_sorted",
    "get_artist_by_id",
    "get_random_tracks",
    "get_track_basic",
    "get_track_full",
    "get_track_path_and_format",
    "get_tracks_by_album_id",
    "get_user_by_username",
    "search_albums",
    "search_artists",
    "search_tracks",
]
