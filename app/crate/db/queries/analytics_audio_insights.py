from crate.db.queries.analytics_audio_distribution_queries import (
    get_insights_bitrate_distribution,
    get_insights_bpm_distribution,
    get_insights_key_distribution,
    get_insights_loudness_distribution,
)
from crate.db.queries.analytics_audio_feature_queries import (
    get_insights_feature_coverage,
    get_insights_mood_distribution,
)
from crate.db.queries.analytics_audio_scatter_queries import (
    get_insights_acoustic_instrumental,
    get_insights_energy_danceability,
)


__all__ = [
    "get_insights_acoustic_instrumental",
    "get_insights_bitrate_distribution",
    "get_insights_bpm_distribution",
    "get_insights_energy_danceability",
    "get_insights_feature_coverage",
    "get_insights_key_distribution",
    "get_insights_loudness_distribution",
    "get_insights_mood_distribution",
]
