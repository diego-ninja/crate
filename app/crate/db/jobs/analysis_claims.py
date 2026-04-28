"""Claim and queue operations for analysis pipelines."""

from __future__ import annotations

import os
import socket
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.jobs.analysis_shared import (
    append_pipeline_event,
    claim_batch_sql,
    ensure_processing_rows,
    mark_ops_snapshot_dirty,
    pipeline_name_for_state_column,
    processing_pending_count_sql,
    processing_pending_exists_sql,
    validate_state_column,
)
from crate.db.tx import transaction_scope


def _ensure_claimable_processing_rows(session, *, pipeline: str, batch_size: int) -> None:
    seed_limit = max(batch_size * 8, batch_size)
    ensure_processing_rows(session, pipeline=pipeline, limit=seed_limit)
    if pipeline == "bliss":
        ensure_processing_rows(session, pipeline="analysis", limit=seed_limit)


def claim_track(state_column: str) -> dict | None:
    """Backward-compatible single-track claim helper."""
    tracks = claim_tracks(state_column, limit=1)
    return tracks[0] if tracks else None


def claim_tracks(state_column: str, *, limit: int = 1) -> list[dict]:
    """Atomically claim the next pending batch for processing."""
    col = validate_state_column(state_column)
    pipeline = pipeline_name_for_state_column(col)
    batch_size = max(1, min(int(limit or 1), 200))
    claimed_at = datetime.now(timezone.utc).isoformat()
    claimed_by = f"{os.environ.get('CRATE_RUNTIME', 'runtime')}:{socket.gethostname()}"
    with transaction_scope() as session:
        _ensure_claimable_processing_rows(session, pipeline=pipeline, batch_size=batch_size)
        pending = session.execute(
            text(processing_pending_exists_sql(col)),
            {"pipeline": pipeline},
        ).scalar()
        if not pending:
            return []
        rows = session.execute(
            text(claim_batch_sql(col)),
            {
                "pipeline": pipeline,
                "claimed_at": claimed_at,
                "claimed_by": claimed_by,
                "limit": batch_size,
            },
        ).mappings().all()
        if rows:
            session.execute(
                text(f"UPDATE library_tracks SET {col} = 'analyzing' WHERE id = ANY(:track_ids)"),
                {"track_ids": [int(row["id"]) for row in rows]},
            )
            for row in rows:
                append_pipeline_event(
                    session,
                    pipeline=pipeline,
                    track_id=int(row["id"]),
                    state="analyzing",
                )
            mark_ops_snapshot_dirty(session)
        return [dict(row) for row in rows]


def release_claims(track_ids: list[int], state_column: str) -> int:
    col = validate_state_column(state_column)
    cleaned = [int(track_id) for track_id in track_ids if track_id]
    if not cleaned:
        return 0
    pipeline = pipeline_name_for_state_column(col)
    with transaction_scope() as session:
        result = session.execute(
            text(f"UPDATE library_tracks SET {col} = 'pending' WHERE id = ANY(:track_ids) AND {col} = 'analyzing'"),
            {"track_ids": cleaned},
        )
        session.execute(
            text(
                """
                UPDATE track_processing_state
                SET state = 'pending',
                    claimed_by = NULL,
                    claimed_at = NULL,
                    updated_at = NOW()
                WHERE pipeline = :pipeline
                  AND track_id = ANY(:track_ids)
                  AND state = 'analyzing'
                """
            ),
            {"pipeline": pipeline, "track_ids": cleaned},
        )
        if result.rowcount:
            mark_ops_snapshot_dirty(session)
        return int(result.rowcount or 0)


def reset_stale_claims(state_column: str) -> int:
    """On startup, reset any tracks stuck in analyzing from a previous crash."""
    col = validate_state_column(state_column)
    with transaction_scope() as session:
        result = session.execute(
            text(f"UPDATE library_tracks SET {col} = 'pending' WHERE {col} = 'analyzing'")
        )
        session.execute(
            text(
                """
                UPDATE track_processing_state
                SET state = 'pending',
                    claimed_by = NULL,
                    claimed_at = NULL,
                    updated_at = NOW()
                WHERE pipeline = :pipeline AND state = 'analyzing'
                """
            ),
            {"pipeline": pipeline_name_for_state_column(col)},
        )
        if result.rowcount:
            mark_ops_snapshot_dirty(session)
        return int(result.rowcount or 0)


def get_pending_count(state_column: str) -> int:
    col = validate_state_column(state_column)
    pipeline = pipeline_name_for_state_column(col)
    with transaction_scope() as session:
        _ensure_claimable_processing_rows(session, pipeline=pipeline, batch_size=2000)
        row = session.execute(
            text(processing_pending_count_sql(col)),
            {"pipeline": pipeline},
        ).mappings().first()
        return int(row["cnt"] or 0) if row else 0


__all__ = [
    "claim_track",
    "claim_tracks",
    "get_pending_count",
    "release_claims",
    "reset_stale_claims",
]
