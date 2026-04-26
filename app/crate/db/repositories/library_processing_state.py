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
                COALESCE(NULLIF(lt.analysis_state, ''), 'pending'),
                NULL,
                NULL,
                0,
                NULL,
                NOW(),
                CASE
                    WHEN COALESCE(NULLIF(lt.analysis_state, ''), 'pending') = 'done'
                    THEN COALESCE(lt.analysis_completed_at, lt.updated_at, NOW())
                    ELSE NULL
                END
            FROM library_tracks lt
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
                COALESCE(NULLIF(lt.bliss_state, ''), 'pending'),
                NULL,
                NULL,
                0,
                NULL,
                NOW(),
                CASE
                    WHEN COALESCE(NULLIF(lt.bliss_state, ''), 'pending') = 'done'
                    THEN COALESCE(lt.bliss_computed_at, lt.updated_at, NOW())
                    ELSE NULL
                END
            FROM library_tracks lt
            WHERE lt.id = :track_id
            ON CONFLICT (track_id, pipeline) DO NOTHING
            """
        ),
        {"track_id": track_id},
    )


__all__ = ["ensure_track_processing_rows"]
