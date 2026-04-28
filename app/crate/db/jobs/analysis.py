"""Compatibility facade for analysis job helpers."""

from __future__ import annotations

from crate.db.jobs.analysis_backfill import backfill_pipeline_read_models
from crate.db.jobs.analysis_claims import (
    claim_track,
    claim_tracks,
    get_pending_count,
    release_claims,
    reset_stale_claims,
)
from crate.db.jobs.analysis_popularity import (
    get_albums_needing_popularity,
    get_tracks_needing_popularity,
    requeue_tracks,
    update_album_popularity,
    update_track_popularity,
)
from crate.db.jobs.analysis_status import (
    get_analysis_status,
    get_artists_needing_analysis,
    get_artists_needing_bliss,
)
from crate.db.jobs.analysis_storage import (
    mark_done,
    mark_failed,
    store_analysis_result,
    store_analysis_results,
    store_bliss_vector,
    store_bliss_vectors,
)


__all__ = [
    "backfill_pipeline_read_models",
    "claim_track",
    "claim_tracks",
    "get_albums_needing_popularity",
    "get_analysis_status",
    "get_artists_needing_analysis",
    "get_artists_needing_bliss",
    "get_pending_count",
    "get_tracks_needing_popularity",
    "mark_done",
    "mark_failed",
    "release_claims",
    "requeue_tracks",
    "reset_stale_claims",
    "store_analysis_result",
    "store_analysis_results",
    "store_bliss_vector",
    "store_bliss_vectors",
    "update_album_popularity",
    "update_track_popularity",
]
