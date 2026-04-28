from __future__ import annotations

from sqlalchemy import text


def backfill_analysis_features(session, *, limit: int) -> int:
    return int(
        session.execute(
            text(
                """
                WITH batch AS (
                    SELECT
                        id AS track_id,
                        bpm,
                        audio_key,
                        audio_scale,
                        energy,
                        mood_json,
                        danceability,
                        valence,
                        acousticness,
                        instrumentalness,
                        loudness,
                        dynamic_range,
                        spectral_complexity,
                        COALESCE(analysis_completed_at, updated_at, NOW()) AS updated_at
                    FROM library_tracks lt
                    WHERE NOT EXISTS (
                        SELECT 1 FROM track_analysis_features taf WHERE taf.track_id = lt.id
                    )
                      AND (
                        bpm IS NOT NULL
                        OR audio_key IS NOT NULL
                        OR energy IS NOT NULL
                        OR mood_json IS NOT NULL
                      )
                    ORDER BY COALESCE(analysis_completed_at, updated_at) DESC NULLS LAST
                    LIMIT :limit
                ),
                inserted AS (
                    INSERT INTO track_analysis_features (
                        track_id,
                        bpm,
                        audio_key,
                        audio_scale,
                        energy,
                        mood_json,
                        danceability,
                        valence,
                        acousticness,
                        instrumentalness,
                        loudness,
                        dynamic_range,
                        spectral_complexity,
                        updated_at
                    )
                    SELECT
                        track_id,
                        bpm,
                        audio_key,
                        audio_scale,
                        energy,
                        CAST(mood_json AS jsonb),
                        danceability,
                        valence,
                        acousticness,
                        instrumentalness,
                        loudness,
                        dynamic_range,
                        spectral_complexity,
                        updated_at
                    FROM batch
                    ON CONFLICT (track_id) DO NOTHING
                    RETURNING 1
                )
                SELECT COUNT(*) FROM inserted
                """
            ),
            {"limit": limit},
        ).scalar()
        or 0
    )


def backfill_bliss_embeddings(session, *, limit: int) -> int:
    return int(
        session.execute(
            text(
                """
                WITH batch AS (
                    SELECT
                        id AS track_id,
                        bliss_vector,
                        COALESCE(
                            bliss_embedding,
                            CAST((chr(91) || array_to_string(bliss_vector, chr(44)) || chr(93)) AS vector(20))
                        ) AS bliss_embedding,
                        COALESCE(bliss_computed_at, updated_at, NOW()) AS updated_at
                    FROM library_tracks lt
                    WHERE NOT EXISTS (
                        SELECT 1 FROM track_bliss_embeddings tbe WHERE tbe.track_id = lt.id
                    )
                      AND bliss_vector IS NOT NULL
                    ORDER BY COALESCE(bliss_computed_at, updated_at) DESC NULLS LAST
                    LIMIT :limit
                ),
                inserted AS (
                    INSERT INTO track_bliss_embeddings (
                        track_id,
                        bliss_vector,
                        bliss_embedding,
                        updated_at
                    )
                    SELECT
                        track_id,
                        bliss_vector,
                        bliss_embedding,
                        updated_at
                    FROM batch
                    ON CONFLICT (track_id) DO NOTHING
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
    "backfill_analysis_features",
    "backfill_bliss_embeddings",
]
