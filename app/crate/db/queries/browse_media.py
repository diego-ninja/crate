from crate.db.queries.browse_media_favorites import add_favorite, list_favorites, remove_favorite
from crate.db.queries.browse_media_mood import count_mood_tracks, get_mood_tracks
from crate.db.queries.browse_media_search import search_albums, search_artists, search_tracks
from crate.db.queries.browse_media_track_genres import get_track_album_genres, get_track_artist_genres
from crate.db.queries.browse_media_track_lookup import (
    clear_track_path_cache,
    find_track_id_by_path,
    get_track_exists,
    get_track_id_by_storage_id,
    get_track_info_cols,
    get_track_info_cols_by_path,
    get_track_info_cols_by_storage_id,
    get_track_path,
    get_track_path_by_storage_id,
)


__all__ = [
    "add_favorite",
    "clear_track_path_cache",
    "count_mood_tracks",
    "find_track_id_by_path",
    "get_mood_tracks",
    "get_track_album_genres",
    "get_track_artist_genres",
    "get_track_exists",
    "get_track_id_by_storage_id",
    "get_track_info_cols",
    "get_track_info_cols_by_path",
    "get_track_info_cols_by_storage_id",
    "get_track_path",
    "get_track_path_by_storage_id",
    "list_favorites",
    "remove_favorite",
    "search_albums",
    "search_artists",
    "search_tracks",
]
