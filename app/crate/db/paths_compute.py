"""Compatibility facade for Music Paths computation primitives."""

from __future__ import annotations

from crate.db.paths_scoring import (
    _find_anchor_track,
    _find_best_candidate,
    _load_artist_genres,
    _load_artist_similarity_graph,
    _load_shared_members_graph,
    compute_path,
)
from crate.db.paths_vectors import _centroid, _lerp, resolve_bliss_centroid, resolve_endpoint_label


__all__ = [
    "_centroid",
    "_find_anchor_track",
    "_find_best_candidate",
    "_lerp",
    "_load_artist_genres",
    "_load_artist_similarity_graph",
    "_load_shared_members_graph",
    "compute_path",
    "resolve_bliss_centroid",
    "resolve_endpoint_label",
]
