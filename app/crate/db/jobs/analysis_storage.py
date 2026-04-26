"""Persistence helpers for analysis and bliss pipeline results."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.bliss_vectors import to_pgvector_literal
from crate.db.jobs.analysis_shared import (
    append_pipeline_event,
    complete_processing_state,
    mark_ops_snapshot_dirty,
    pipeline_name_for_state_column,
    validate_state_column,
)
from crate.db.repositories.library_analysis_writes import update_track_analysis
from crate.db.tx import transaction_scope


def mark_done(track_id: int, state_column: str) -> None:
    col = validate_state_column(state_column)
    now = datetime.now(timezone.utc).isoformat()
    extra_set = ""
    if col == "analysis_state":
        extra_set = ", analysis_completed_at = :now"
    elif col == "bliss_state":
        extra_set = ", bliss_computed_at = :now"
    pipeline = pipeline_name_for_state_column(col)
    with transaction_scope() as session:
        session.execute(
            text(f"UPDATE library_tracks SET {col} = 'done'{extra_set} WHERE id = :id"),
            {"now": now, "id": track_id},
        )
        complete_processing_state(
            session,
            track_id=track_id,
            pipeline=pipeline,
            completed_at=now,
        )
        mark_ops_snapshot_dirty(session)
        append_pipeline_event(session, pipeline=pipeline, track_id=track_id, state="done")


def mark_failed(track_id: int, state_column: str, error_message: str | None = None) -> None:
    col = validate_state_column(state_column)
    pipeline = pipeline_name_for_state_column(col)
    with transaction_scope() as session:
        session.execute(
            text(f"UPDATE library_tracks SET {col} = 'failed' WHERE id = :id"),
            {"id": track_id},
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
                    updated_at
                )
                VALUES (
                    :track_id,
                    :pipeline,
                    'failed',
                    NULL,
                    NULL,
                    1,
                    :last_error,
                    NOW()
                )
                ON CONFLICT (track_id, pipeline) DO UPDATE SET
                    state = 'failed',
                    claimed_by = NULL,
                    claimed_at = NULL,
                    last_error = COALESCE(:last_error, track_processing_state.last_error),
                    updated_at = NOW()
                """
            ),
            {
                "track_id": track_id,
                "pipeline": pipeline,
                "last_error": error_message,
            },
        )
        mark_ops_snapshot_dirty(session)
        append_pipeline_event(
            session,
            pipeline=pipeline,
            track_id=track_id,
            state="failed",
            error_message=error_message,
        )


def store_bliss_vector(track_id: int, vector: list[float]) -> None:
    store_bliss_vectors({track_id: vector})


def store_bliss_vectors(vectors_by_track_id: dict[int, list[float]]) -> None:
    if not vectors_by_track_id:
        return

    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        for track_id, vector in vectors_by_track_id.items():
            session.execute(
                text(
                    "UPDATE library_tracks "
                    "SET bliss_vector = :vector, "
                    "    bliss_embedding = CAST(:vector_literal AS vector(20)), "
                    "    bliss_state = 'done', "
                    "    bliss_computed_at = :now "
                    "WHERE id = :id"
                ),
                {"vector": vector, "vector_literal": to_pgvector_literal(vector), "now": now, "id": track_id},
            )
            session.execute(
                text(
                    """
                    INSERT INTO track_bliss_embeddings (track_id, bliss_vector, bliss_embedding, updated_at)
                    VALUES (:track_id, :vector, CAST(:vector_literal AS vector(20)), :updated_at)
                    ON CONFLICT (track_id) DO UPDATE SET
                        bliss_vector = EXCLUDED.bliss_vector,
                        bliss_embedding = EXCLUDED.bliss_embedding,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "track_id": track_id,
                    "vector": vector,
                    "vector_literal": to_pgvector_literal(vector),
                    "updated_at": now,
                },
            )
            complete_processing_state(session, track_id=track_id, pipeline="bliss", completed_at=now)
            append_pipeline_event(session, pipeline="bliss", track_id=track_id, state="done")
        mark_ops_snapshot_dirty(session)


def store_analysis_result(track_id: int, path: str, result: dict) -> None:
    store_analysis_results([(track_id, path, result)])


def store_analysis_results(results: list[tuple[int, str, dict]]) -> None:
    if not results:
        return

    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        for track_id, path, result in results:
            update_track_analysis(
                path,
                bpm=result["bpm"],
                key=result.get("key"),
                scale=result.get("scale"),
                energy=result.get("energy"),
                mood=result.get("mood"),
                danceability=result.get("danceability"),
                valence=result.get("valence"),
                acousticness=result.get("acousticness"),
                instrumentalness=result.get("instrumentalness"),
                loudness=result.get("loudness"),
                dynamic_range=result.get("dynamic_range"),
                spectral_complexity=result.get("spectral_complexity"),
                session=session,
            )
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET analysis_state = 'done',
                        analysis_completed_at = :now
                    WHERE id = :track_id
                    """
                ),
                {"track_id": track_id, "now": now},
            )
            complete_processing_state(session, track_id=track_id, pipeline="analysis", completed_at=now)
            append_pipeline_event(session, pipeline="analysis", track_id=track_id, state="done")
        mark_ops_snapshot_dirty(session)


__all__ = [
    "mark_done",
    "mark_failed",
    "store_analysis_result",
    "store_analysis_results",
    "store_bliss_vector",
    "store_bliss_vectors",
]
