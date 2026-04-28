"""Compatibility facade for bliss similarity and radio queries."""

from crate.db.queries.bliss_artists import (
    build_user_radio_profile,
    get_artist_by_id,
    get_artist_genre_ids,
    get_artist_genre_map,
    get_artist_tracks,
    get_similar_artist_rows,
)
from crate.db.queries.bliss_radio_candidates import (
    get_album_tracks_for_radio,
    get_playlist_tracks_for_radio,
    get_similar_artist_tracks_for_radio,
)
from crate.db.queries.bliss_similarity_candidates import (
    get_bliss_candidates,
    get_multi_seed_bliss_candidates,
    get_recommend_without_bliss_candidates,
)
from crate.db.queries.bliss_track_lookup import (
    get_same_artist_tracks,
    get_seed_tracks_by_paths,
    get_track_with_artist,
)
from crate.db.queries.bliss_storage import store_bliss_vectors

__all__ = [
    "build_user_radio_profile",
    "get_album_tracks_for_radio",
    "get_artist_by_id",
    "get_artist_genre_ids",
    "get_artist_genre_map",
    "get_artist_tracks",
    "get_bliss_candidates",
    "get_multi_seed_bliss_candidates",
    "get_playlist_tracks_for_radio",
    "get_recommend_without_bliss_candidates",
    "get_same_artist_tracks",
    "get_seed_tracks_by_paths",
    "get_similar_artist_rows",
    "get_similar_artist_tracks_for_radio",
    "get_track_with_artist",
    "store_bliss_vectors",
]
