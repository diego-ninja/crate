from crate.db.queries.analytics_catalog_distribution_queries import (
    get_insights_albums_by_year,
    get_insights_countries,
    get_insights_format_distribution,
)
from crate.db.queries.analytics_catalog_genre_queries import (
    get_insights_top_albums,
    get_insights_top_genres,
)
from crate.db.queries.analytics_catalog_popularity_queries import (
    get_insights_artist_depth,
    get_insights_popularity,
)


__all__ = [
    "get_insights_albums_by_year",
    "get_insights_artist_depth",
    "get_insights_countries",
    "get_insights_format_distribution",
    "get_insights_popularity",
    "get_insights_top_albums",
    "get_insights_top_genres",
]
