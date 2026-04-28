from __future__ import annotations

from sqlalchemy import text


def backfill_analysis_processing_state(session, *, limit: int) -> int:
    return int(
        session.execute(
            text(
                """
                WITH batch AS (
                    SELECT
                        lt.id,
                        CASE
                            WHEN taf.track_id IS NOT NULL THEN 'done'
                            WHEN (
                                lt.bpm IS NOT NULL
                                OR lt.audio_key IS NOT NULL
                                OR lt.energy IS NOT NULL
                                OR lt.mood_json IS NOT NULL
                                OR lt.danceability IS NOT NULL
                                OR lt.valence IS NOT NULL
                                OR lt.acousticness IS NOT NULL
                                OR lt.instrumentalness IS NOT NULL
                                OR lt.loudness IS NOT NULL
                                OR lt.dynamic_range IS NOT NULL
                                OR lt.spectral_complexity IS NOT NULL
                            ) THEN 'done'
                            WHEN analysis_state IN ('analyzing', 'failed') THEN analysis_state
                            ELSE 'pending'
                        END AS state,
                        CASE
                            WHEN taf.track_id IS NOT NULL THEN COALESCE(taf.updated_at, analysis_completed_at, lt.updated_at, NOW())
                            WHEN (
                                lt.bpm IS NOT NULL
                                OR lt.audio_key IS NOT NULL
                                OR lt.energy IS NOT NULL
                                OR lt.mood_json IS NOT NULL
                                OR lt.danceability IS NOT NULL
                                OR lt.valence IS NOT NULL
                                OR lt.acousticness IS NOT NULL
                                OR lt.instrumentalness IS NOT NULL
                                OR lt.loudness IS NOT NULL
                                OR lt.dynamic_range IS NOT NULL
                                OR lt.spectral_complexity IS NOT NULL
                            ) THEN COALESCE(analysis_completed_at, lt.updated_at, NOW())
                            ELSE NULL
                        END AS completed_at
                    FROM library_tracks lt
                    LEFT JOIN track_analysis_features taf ON taf.track_id = lt.id
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
                        state,
                        NULL,
                        NULL,
                        0,
                        NOW(),
                        completed_at
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
                    SELECT
                        lt.id,
                        CASE
                            WHEN tbe.track_id IS NOT NULL THEN 'done'
                            WHEN lt.bliss_vector IS NOT NULL THEN 'done'
                            WHEN bliss_state IN ('analyzing', 'failed') THEN bliss_state
                            ELSE 'pending'
                        END AS state,
                        CASE
                            WHEN tbe.track_id IS NOT NULL THEN COALESCE(tbe.updated_at, bliss_computed_at, lt.updated_at, NOW())
                            WHEN lt.bliss_vector IS NOT NULL THEN COALESCE(bliss_computed_at, lt.updated_at, NOW())
                            ELSE NULL
                        END AS completed_at
                    FROM library_tracks lt
                    LEFT JOIN track_bliss_embeddings tbe ON tbe.track_id = lt.id
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
                        state,
                        NULL,
                        NULL,
                        0,
                        NOW(),
                        completed_at
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
