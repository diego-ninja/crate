from __future__ import annotations

from crate.db.queries.genres_graph_related import (
    get_genre_cooccurring_album_slugs,
    get_genre_cooccurring_artist_slugs,
    get_genre_seed_artists,
)
from crate.db.queries.genres_library import (
    get_all_genres,
    get_albums_with_genres,
    get_artist_album_genres,
    get_artists_missing_genre_mapping,
    get_artists_with_tags,
    get_genre_detail,
    get_total_genre_count,
    get_unmapped_genre_count,
    get_unmapped_genres,
    list_unmapped_genres_for_inference,
)
from crate.db.queries.genres_taxonomy import (
    get_genre_taxonomy_node_id,
    get_remaining_without_external_description,
    list_genre_taxonomy_nodes_for_external_enrichment,
    list_genre_taxonomy_nodes_for_musicbrainz_sync,
    list_invalid_genre_taxonomy_nodes,
)
from crate.db.queries.genres_taxonomy_graph import get_genre_graph

__all__ = [
    "get_all_genres",
    "get_albums_with_genres",
    "get_artist_album_genres",
    "get_artists_missing_genre_mapping",
    "get_artists_with_tags",
    "get_genre_cooccurring_album_slugs",
    "get_genre_cooccurring_artist_slugs",
    "get_genre_detail",
    "get_genre_graph",
    "get_genre_seed_artists",
    "get_genre_taxonomy_node_id",
    "get_remaining_without_external_description",
    "get_total_genre_count",
    "get_unmapped_genre_count",
    "get_unmapped_genres",
    "list_genre_taxonomy_nodes_for_external_enrichment",
    "list_genre_taxonomy_nodes_for_musicbrainz_sync",
    "list_invalid_genre_taxonomy_nodes",
    "list_unmapped_genres_for_inference",
]
