"""Compatibility facade for music path read queries."""

from __future__ import annotations

from crate.db.queries.paths_endpoint_queries import fetch_bliss_vectors_for_endpoint, resolve_endpoint_label
from crate.db.queries.paths_graph_queries import (
    find_anchor_track_row,
    find_candidate_rows,
    load_artist_genres,
    load_artist_radio_graphs,
    load_artist_similarity_graph,
    load_shared_members_graph,
)
from crate.db.queries.paths_store_queries import get_music_path_row, list_music_path_rows

__all__ = [
    "fetch_bliss_vectors_for_endpoint",
    "find_anchor_track_row",
    "find_candidate_rows",
    "get_music_path_row",
    "list_music_path_rows",
    "load_artist_genres",
    "load_artist_radio_graphs",
    "load_artist_similarity_graph",
    "load_shared_members_graph",
    "resolve_endpoint_label",
]
