from crate.db.jobs.popularity_ingest import (
    bulk_update_lastfm_top_track_signals,
    bulk_update_spotify_track_signals,
    get_albums_without_popularity,
    get_artist_track_popularity_context,
    get_tracks_without_popularity,
    reset_track_popularity_signals,
    update_album_lastfm,
    update_track_lastfm,
)
from crate.db.jobs.popularity_scoring import (
    get_popularity_scales,
    list_albums_for_popularity_scoring,
    list_artists_for_popularity_scoring,
    list_tracks_for_popularity_scoring,
)
from crate.db.jobs.popularity_writes import (
    bulk_update_album_popularity_scores,
    bulk_update_artist_popularity_scores,
    bulk_update_track_popularity_scores,
    normalize_popularity_scores,
)

__all__ = [
    "bulk_update_album_popularity_scores",
    "bulk_update_artist_popularity_scores",
    "bulk_update_lastfm_top_track_signals",
    "bulk_update_spotify_track_signals",
    "bulk_update_track_popularity_scores",
    "get_albums_without_popularity",
    "get_artist_track_popularity_context",
    "get_popularity_scales",
    "get_tracks_without_popularity",
    "list_albums_for_popularity_scoring",
    "list_artists_for_popularity_scoring",
    "list_tracks_for_popularity_scoring",
    "normalize_popularity_scores",
    "reset_track_popularity_signals",
    "update_album_lastfm",
    "update_track_lastfm",
]
