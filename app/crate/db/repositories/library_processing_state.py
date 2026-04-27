"""Processing-state write helpers for library tracks."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session


def ensure_track_processing_rows(session: Session, track_id: int) -> None:
    session.execute(
        text(
            """
            INSERT INTO track_processing_state (
                track_id,
                pipeline,
                state,
                claimed_by,
                claimed_at,
                attempts,
                last_error,
                updated_at,
                completed_at
            )
            SELECT
                lt.id,
                'analysis',
                CASE
                    WHEN taf.track_id IS NOT NULL THEN 'done'
                    WHEN COALESCE(NULLIF(lt.analysis_state, ''), 'pending') IN ('pending', 'analyzing', 'done', 'failed')
                    THEN COALESCE(NULLIF(lt.analysis_state, ''), 'pending')
                    ELSE 'pending'
                END,
                NULL,
                NULL,
                0,
                NULL,
                NOW(),
                CASE
                    WHEN taf.track_id IS NOT NULL
                    THEN COALESCE(taf.updated_at, lt.analysis_completed_at, lt.updated_at, NOW())
                    WHEN COALESCE(NULLIF(lt.analysis_state, ''), 'pending') = 'done'
                    THEN COALESCE(lt.analysis_completed_at, lt.updated_at, NOW())
                    ELSE NULL
                END
            FROM library_tracks lt
            LEFT JOIN track_analysis_features taf ON taf.track_id = lt.id
            WHERE lt.id = :track_id
            ON CONFLICT (track_id, pipeline) DO NOTHING
            """
        ),
        {"track_id": track_id},
    )
    session.execute(
        text(
            """
            INSERT INTO track_processing_state (
                track_id,
                pipeline,
                state,
                claimed_by,
                claimed_at,
                attempts,
                last_error,
                updated_at,
                completed_at
            )
            SELECT
                lt.id,
                'bliss',
                CASE
                    WHEN tbe.track_id IS NOT NULL THEN 'done'
                    WHEN COALESCE(NULLIF(lt.bliss_state, ''), 'pending') IN ('pending', 'analyzing', 'done', 'failed')
                    THEN COALESCE(NULLIF(lt.bliss_state, ''), 'pending')
                    ELSE 'pending'
                END,
                NULL,
                NULL,
                0,
                NULL,
                NOW(),
                CASE
                    WHEN tbe.track_id IS NOT NULL
                    THEN COALESCE(tbe.updated_at, lt.bliss_computed_at, lt.updated_at, NOW())
                    WHEN COALESCE(NULLIF(lt.bliss_state, ''), 'pending') = 'done'
                    THEN COALESCE(lt.bliss_computed_at, lt.updated_at, NOW())
                    ELSE NULL
                END
            FROM library_tracks lt
            LEFT JOIN track_bliss_embeddings tbe ON tbe.track_id = lt.id
            WHERE lt.id = :track_id
            ON CONFLICT (track_id, pipeline) DO NOTHING
            """
        ),
        {"track_id": track_id},
    )


__all__ = ["ensure_track_processing_rows"]
