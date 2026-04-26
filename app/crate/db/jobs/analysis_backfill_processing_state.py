from __future__ import annotations

from sqlalchemy import text


def backfill_analysis_processing_state(session, *, limit: int) -> int:
    return int(
        session.execute(
            text(
                """
                WITH batch AS (
                    SELECT id,
                           analysis_state,
                           COALESCE(analysis_completed_at, updated_at, NOW()) AS completed_at
                    FROM library_tracks lt
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM track_processing_state ps
                        WHERE ps.track_id = lt.id AND ps.pipeline = 'analysis'
                    )
                    ORDER BY id
                    LIMIT :limit
                ),
                inserted AS (
                    INSERT INTO track_processing_state (
                        track_id,
                        pipeline,
                        state,
                        claimed_by,
                        claimed_at,
                        attempts,
                        updated_at,
                        completed_at
                    )
                    SELECT
                        id,
                        'analysis',
                        CASE
                            WHEN analysis_state IN ('pending', 'analyzing', 'done', 'failed') THEN analysis_state
                            ELSE 'pending'
                        END,
                        NULL,
                        NULL,
                        0,
                        NOW(),
                        CASE WHEN analysis_state = 'done' THEN completed_at ELSE NULL END
                    FROM batch
                    ON CONFLICT (track_id, pipeline) DO NOTHING
                    RETURNING 1
                )
                SELECT COUNT(*) FROM inserted
                """
            ),
            {"limit": limit},
        ).scalar()
        or 0
    )


def backfill_bliss_processing_state(session, *, limit: int) -> int:
    return int(
        session.execute(
            text(
                """
                WITH batch AS (
                    SELECT id,
                           bliss_state,
                           COALESCE(bliss_computed_at, updated_at, NOW()) AS completed_at
                    FROM library_tracks lt
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM track_processing_state ps
                        WHERE ps.track_id = lt.id AND ps.pipeline = 'bliss'
                    )
                    ORDER BY id
                    LIMIT :limit
                ),
                inserted AS (
                    INSERT INTO track_processing_state (
                        track_id,
                        pipeline,
                        state,
                        claimed_by,
                        claimed_at,
                        attempts,
                        updated_at,
                        completed_at
                    )
                    SELECT
                        id,
                        'bliss',
                        CASE
                            WHEN bliss_state IN ('pending', 'analyzing', 'done', 'failed') THEN bliss_state
                            ELSE 'pending'
                        END,
                        NULL,
                        NULL,
                        0,
                        NOW(),
                        CASE WHEN bliss_state = 'done' THEN completed_at ELSE NULL END
                    FROM batch
                    ON CONFLICT (track_id, pipeline) DO NOTHING
                    RETURNING 1
                )
                SELECT COUNT(*) FROM inserted
                """
            ),
            {"limit": limit},
        ).scalar()
        or 0
    )


__all__ = [
    "backfill_analysis_processing_state",
    "backfill_bliss_processing_state",
]
