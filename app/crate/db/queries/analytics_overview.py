from __future__ import annotations

from crate.db.queries.analytics_overview_distributions import (
    get_bitrate_distribution,
    get_decade_distribution,
    get_format_distribution,
    get_genre_distribution,
    get_sizes_by_format_gb,
)
from crate.db.queries.analytics_overview_stats import (
    get_avg_tracks_per_album,
    get_stats_analyzed_track_count,
    get_stats_avg_album_duration_min,
    get_stats_avg_bitrate,
    get_stats_duration_hours,
    get_stats_recent_albums,
    get_stats_top_genres,
    get_top_artists_by_albums,
    get_total_duration_hours,
)
from crate.db.queries.analytics_overview_timeline import get_timeline_albums


__all__ = [
    "get_avg_tracks_per_album",
    "get_bitrate_distribution",
    "get_decade_distribution",
    "get_format_distribution",
    "get_genre_distribution",
    "get_sizes_by_format_gb",
    "get_stats_analyzed_track_count",
    "get_stats_avg_album_duration_min",
    "get_stats_avg_bitrate",
    "get_stats_duration_hours",
    "get_stats_recent_albums",
    "get_stats_top_genres",
    "get_timeline_albums",
    "get_top_artists_by_albums",
    "get_total_duration_hours",
]
