from __future__ import annotations

from sqlalchemy import text


def _processing_seed_sql(*, pipeline: str) -> tuple[str, str, str]:
    if pipeline == "analysis":
        return (
            """
                LEFT JOIN track_analysis_features taf ON taf.track_id = lt.id
            """,
            """
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
                END AS state
            """,
            """
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
            """,
        )
    if pipeline == "bliss":
        return (
            """
                LEFT JOIN track_bliss_embeddings tbe ON tbe.track_id = lt.id
            """,
            """
                CASE
                    WHEN tbe.track_id IS NOT NULL THEN 'done'
                    WHEN lt.bliss_vector IS NOT NULL THEN 'done'
                    WHEN bliss_state IN ('analyzing', 'failed') THEN bliss_state
                    ELSE 'pending'
                END AS state
            """,
            """
                CASE
                    WHEN tbe.track_id IS NOT NULL THEN COALESCE(tbe.updated_at, bliss_computed_at, lt.updated_at, NOW())
                    WHEN lt.bliss_vector IS NOT NULL THEN COALESCE(bliss_computed_at, lt.updated_at, NOW())
                    ELSE NULL
                END AS completed_at
            """,
        )
    raise ValueError(f"Invalid pipeline: {pipeline!r}")


def complete_processing_state(session, *, track_id: int, pipeline: str, completed_at: str) -> None:
    session.execute(
        text(
            """
            UPDATE track_processing_state
            SET state = 'done',
                claimed_by = NULL,
                claimed_at = NULL,
                last_error = NULL,
                completed_at = :completed_at,
                updated_at = :completed_at
            WHERE track_id = :track_id AND pipeline = :pipeline
            """
        ),
        {"track_id": track_id, "pipeline": pipeline, "completed_at": completed_at},
    )


def ensure_processing_rows(session, *, pipeline: str, limit: int) -> None:
    if pipeline not in {"analysis", "bliss"}:
        raise ValueError(f"Invalid pipeline: {pipeline!r}")

    shadow_join, state_sql, completed_at_sql = _processing_seed_sql(pipeline=pipeline)

    session.execute(
        text(
            f"""
            WITH batch AS (
                SELECT
                    lt.id AS track_id,
                    {state_sql},
                    {completed_at_sql}
                FROM library_tracks lt
                {shadow_join}
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM track_processing_state ps
                    WHERE ps.track_id = lt.id AND ps.pipeline = :pipeline
                )
                ORDER BY lt.updated_at DESC NULLS LAST, lt.id DESC
                LIMIT :limit
            )
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
                track_id,
                :pipeline,
                state,
                NULL,
                NULL,
                0,
                NULL,
                NOW(),
                completed_at
            FROM batch
            ON CONFLICT (track_id, pipeline) DO NOTHING
            """
        ),
        {"pipeline": pipeline, "limit": max(1, int(limit or 1))},
    )


def processing_pending_exists_sql(state_column: str) -> str:
    if state_column == "bliss_state":
        return """
            SELECT EXISTS(
                SELECT 1
                FROM track_processing_state ps
                JOIN library_tracks lt ON lt.id = ps.track_id
                LEFT JOIN track_processing_state aps
                  ON aps.track_id = lt.id
                 AND aps.pipeline = 'analysis'
                WHERE ps.pipeline = :pipeline
                  AND ps.state = 'pending'
                  AND lt.path IS NOT NULL
                  AND COALESCE(aps.state, 'pending') != 'analyzing'
            )
        """
    return """
        SELECT EXISTS(
            SELECT 1
            FROM track_processing_state ps
            JOIN library_tracks lt ON lt.id = ps.track_id
            WHERE ps.pipeline = :pipeline
              AND ps.state = 'pending'
              AND lt.path IS NOT NULL
        )
    """


def processing_pending_count_sql(state_column: str) -> str:
    if state_column == "bliss_state":
        return """
            SELECT COUNT(*) AS cnt
            FROM track_processing_state ps
            JOIN library_tracks lt ON lt.id = ps.track_id
            LEFT JOIN track_processing_state aps
              ON aps.track_id = lt.id
             AND aps.pipeline = 'analysis'
            WHERE ps.pipeline = :pipeline
              AND ps.state = 'pending'
              AND lt.path IS NOT NULL
              AND COALESCE(aps.state, 'pending') != 'analyzing'
        """
    return """
        SELECT COUNT(*) AS cnt
        FROM track_processing_state ps
        JOIN library_tracks lt ON lt.id = ps.track_id
        WHERE ps.pipeline = :pipeline
          AND ps.state = 'pending'
          AND lt.path IS NOT NULL
    """


def claim_batch_sql(state_column: str) -> str:
    if state_column == "bliss_state":
        extra_join = """
            LEFT JOIN track_processing_state aps
              ON aps.track_id = lt.id
             AND aps.pipeline = 'analysis'
        """
        extra_where = "AND COALESCE(aps.state, 'pending') != 'analyzing'"
    else:
        extra_join = ""
        extra_where = ""

    return f"""
        WITH batch AS (
            SELECT ps.track_id
            FROM track_processing_state ps
            JOIN library_tracks lt ON lt.id = ps.track_id
            {extra_join}
            WHERE ps.pipeline = :pipeline
              AND ps.state = 'pending'
              AND lt.path IS NOT NULL
              {extra_where}
            ORDER BY lt.updated_at DESC
            LIMIT :limit
            FOR UPDATE OF ps SKIP LOCKED
        ),
        claimed AS (
            UPDATE track_processing_state ps
            SET state = 'analyzing',
                claimed_by = :claimed_by,
                claimed_at = :claimed_at,
                attempts = ps.attempts + 1,
                last_error = NULL,
                updated_at = :claimed_at
            FROM batch
            WHERE ps.track_id = batch.track_id
              AND ps.pipeline = :pipeline
            RETURNING ps.track_id
        )
        SELECT lt.id, lt.path, lt.title, lt.artist, lt.album
        FROM claimed
        JOIN library_tracks lt ON lt.id = claimed.track_id
    """


__all__ = [
    "claim_batch_sql",
    "complete_processing_state",
    "ensure_processing_rows",
    "processing_pending_count_sql",
    "processing_pending_exists_sql",
]
