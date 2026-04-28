"""Legacy compatibility shim for shaped radio access.

New runtime code should import from ``crate.db.queries.radio`` for read-only
seed/history lookups and ``crate.db.repositories.radio`` for feedback writes.
This module remains only to keep the deprecated compat surface and older
tests/scripts working while the backend migration finishes.
"""

from crate.db.queries.radio import (
    count_user_radio_signals,
    get_followed_artist_vectors,
    get_home_playlist_seed,
    get_playlist_seed,
    get_random_library_vectors,
    get_recent_liked_vectors,
    get_recent_play_vectors,
    get_saved_album_vectors,
    get_track_bliss_vector,
    get_track_seed,
    load_feedback_history,
)
from crate.db.repositories.radio import persist_radio_feedback

__all__ = [
    "count_user_radio_signals",
    "get_followed_artist_vectors",
    "get_home_playlist_seed",
    "get_playlist_seed",
    "get_random_library_vectors",
    "get_recent_liked_vectors",
    "get_recent_play_vectors",
    "get_saved_album_vectors",
    "get_track_bliss_vector",
    "get_track_seed",
    "load_feedback_history",
    "persist_radio_feedback",
]
