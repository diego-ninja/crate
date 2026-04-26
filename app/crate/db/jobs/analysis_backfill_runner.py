"""Backfill helpers for shadow pipeline read models."""

from __future__ import annotations

from crate.db.jobs.analysis_backfill_processing_state import (
    backfill_analysis_processing_state,
    backfill_bliss_processing_state,
)
from crate.db.jobs.analysis_backfill_shadow_tables import (
    backfill_analysis_features,
    backfill_bliss_embeddings,
)
from crate.db.jobs.analysis_shared import mark_ops_snapshot_dirty
from crate.db.tx import transaction_scope


def backfill_pipeline_read_models(*, limit: int = 1000) -> dict[str, int]:
    """Incrementally backfill shadow pipeline tables from legacy hot columns."""
    batch_size = max(1, min(int(limit or 1000), 5000))
    with transaction_scope() as session:
        analysis_state_inserted = backfill_analysis_processing_state(session, limit=batch_size)
        bliss_state_inserted = backfill_bliss_processing_state(session, limit=batch_size)
        analysis_features_inserted = backfill_analysis_features(session, limit=batch_size)
        bliss_embeddings_inserted = backfill_bliss_embeddings(session, limit=batch_size)
        inserted_total = (
            analysis_state_inserted
            + bliss_state_inserted
            + analysis_features_inserted
            + bliss_embeddings_inserted
        )
        if inserted_total:
            mark_ops_snapshot_dirty(session)
    return {
        "processing_analysis": analysis_state_inserted,
        "processing_bliss": bliss_state_inserted,
        "analysis_features": analysis_features_inserted,
        "bliss_embeddings": bliss_embeddings_inserted,
    }


__all__ = ["backfill_pipeline_read_models"]
