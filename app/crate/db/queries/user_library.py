from __future__ import annotations

from crate.db.queries.user_library_history import (
    get_play_history,
    get_play_history_rows,
    resolve_play_history_album_fallback,
)
from crate.db.queries.user_library_library import (
    get_followed_artists,
    get_liked_tracks,
    get_saved_albums,
    get_user_library_counts,
    is_album_saved,
    is_following,
    is_track_liked,
)
from crate.db.queries.user_library_stats import (
    get_play_stats,
    get_replay_mix,
    get_stats_overview,
    get_stats_trend_points,
    get_stats_trends,
    get_top_albums,
    get_top_artists,
    get_top_genres,
    get_top_tracks,
)

__all__ = [
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
    "resolve_play_history_album_fallback",
]
