from __future__ import annotations

from crate.db.queries.analytics_audio_insights import (
    get_insights_acoustic_instrumental,
    get_insights_bitrate_distribution,
    get_insights_bpm_distribution,
    get_insights_energy_danceability,
    get_insights_feature_coverage,
    get_insights_key_distribution,
    get_insights_loudness_distribution,
    get_insights_mood_distribution,
)
from crate.db.queries.analytics_catalog_insights import (
    get_insights_albums_by_year,
    get_insights_artist_depth,
    get_insights_countries,
    get_insights_format_distribution,
    get_insights_popularity,
    get_insights_top_albums,
    get_insights_top_genres,
)

__all__ = [
    "get_insights_acoustic_instrumental",
    "get_insights_albums_by_year",
    "get_insights_artist_depth",
    "get_insights_bitrate_distribution",
    "get_insights_bpm_distribution",
    "get_insights_countries",
    "get_insights_energy_danceability",
    "get_insights_feature_coverage",
    "get_insights_format_distribution",
    "get_insights_key_distribution",
    "get_insights_loudness_distribution",
    "get_insights_mood_distribution",
    "get_insights_popularity",
    "get_insights_top_albums",
    "get_insights_top_genres",
]
