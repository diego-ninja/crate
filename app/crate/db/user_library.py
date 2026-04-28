"""Legacy compatibility shim for user library access.

New runtime code should import from ``crate.db.repositories.user_library`` for
writes and ``crate.db.queries.user_library`` for reads. This module remains
only to keep the deprecated compat surface and older tests/scripts working
while the backend migration finishes.
"""

from crate.db.queries.user_library import (
    get_followed_artists,
    get_liked_tracks,
    get_play_history,
    get_play_history_rows,
    get_play_stats,
    get_replay_mix,
    get_saved_albums,
    get_stats_overview,
    get_stats_trend_points,
    get_stats_trends,
    get_top_albums,
    get_top_artists,
    get_top_genres,
    get_top_tracks,
    get_user_library_counts,
    is_album_saved,
    is_following,
    is_track_liked,
    resolve_play_history_album_fallback,
)
from crate.db.repositories.user_library import (
    follow_artist,
    like_track,
    record_play,
    record_play_event,
    recompute_user_listening_aggregates,
    save_album,
    unfollow_artist,
    unlike_track,
    unsave_album,
)

__all__ = [
    "follow_artist",
    "get_followed_artists",
    "get_liked_tracks",
    "get_play_history",
    "get_play_history_rows",
    "get_play_stats",
    "get_replay_mix",
    "get_saved_albums",
    "get_stats_overview",
    "get_stats_trend_points",
    "get_stats_trends",
    "get_top_albums",
    "get_top_artists",
    "get_top_genres",
    "get_top_tracks",
    "get_user_library_counts",
    "is_album_saved",
    "is_following",
    "is_track_liked",
    "like_track",
    "record_play",
    "record_play_event",
    "recompute_user_listening_aggregates",
    "resolve_play_history_album_fallback",
    "save_album",
    "unfollow_artist",
    "unlike_track",
    "unsave_album",
]
