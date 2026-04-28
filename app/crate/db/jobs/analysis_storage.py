"""Persistence helpers for analysis and bliss pipeline results."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.bliss_vectors import to_pgvector_literal
from crate.db.jobs.analysis_shared import (
    append_pipeline_event,
    complete_processing_state,
    complete_processing_states,
    mark_ops_snapshot_dirty,
    pipeline_name_for_state_column,
    validate_state_column,
)
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
    rows = [
        {
            "track_id": int(track_id),
            "vector": vector,
            "vector_literal": to_pgvector_literal(vector),
        }
        for track_id, vector in vectors_by_track_id.items()
        if track_id and vector
    ]
    if not rows:
        return

    with transaction_scope() as session:
        rows_json = json.dumps(rows, default=str)
        session.execute(
            text(
                """
                WITH rows AS (
                    SELECT track_id, vector, vector_literal
                    FROM jsonb_to_recordset(CAST(:rows_json AS jsonb)) AS rows(
                        track_id INTEGER,
                        vector DOUBLE PRECISION[],
                        vector_literal TEXT
                    )
                )
                UPDATE library_tracks lt
                SET bliss_vector = rows.vector,
                    bliss_embedding = CAST(rows.vector_literal AS vector(20)),
                    bliss_state = 'done',
                    bliss_computed_at = :now
                FROM rows
                WHERE lt.id = rows.track_id
                """
            ),
            {"rows_json": rows_json, "now": now},
        )
        session.execute(
            text(
                """
                INSERT INTO track_bliss_embeddings (track_id, bliss_vector, bliss_embedding, updated_at)
                SELECT
                    rows.track_id,
                    rows.vector,
                    CAST(rows.vector_literal AS vector(20)),
                    :updated_at
                FROM jsonb_to_recordset(CAST(:rows_json AS jsonb)) AS rows(
                    track_id INTEGER,
                    vector DOUBLE PRECISION[],
                    vector_literal TEXT
                )
                ON CONFLICT (track_id) DO UPDATE SET
                    bliss_vector = EXCLUDED.bliss_vector,
                    bliss_embedding = EXCLUDED.bliss_embedding,
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {"rows_json": rows_json, "updated_at": now},
        )
        complete_processing_states(
            session,
            track_ids=[row["track_id"] for row in rows],
            pipeline="bliss",
            completed_at=now,
        )
        for row in rows:
            append_pipeline_event(session, pipeline="bliss", track_id=row["track_id"], state="done")
        mark_ops_snapshot_dirty(session)


def store_analysis_result(track_id: int, path: str, result: dict) -> None:
    store_analysis_results([(track_id, path, result)])


def store_analysis_results(results: list[tuple[int, str, dict]]) -> None:
    if not results:
        return

    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for track_id, _path, result in results:
        rows.append(
            {
                "track_id": int(track_id),
                "bpm": result["bpm"],
                "audio_key": result.get("key"),
                "audio_scale": result.get("scale"),
                "energy": result.get("energy"),
                "mood_json": result.get("mood"),
                "danceability": result.get("danceability"),
                "valence": result.get("valence"),
                "acousticness": result.get("acousticness"),
                "instrumentalness": result.get("instrumentalness"),
                "loudness": result.get("loudness"),
                "dynamic_range": result.get("dynamic_range"),
                "spectral_complexity": result.get("spectral_complexity"),
            }
        )

    with transaction_scope() as session:
        rows_json = json.dumps(rows, default=str)
        session.execute(
            text(
                """
                WITH rows AS (
                    SELECT
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
                        spectral_complexity
                    FROM jsonb_to_recordset(CAST(:rows_json AS jsonb)) AS rows(
                        track_id INTEGER,
                        bpm DOUBLE PRECISION,
                        audio_key TEXT,
                        audio_scale TEXT,
                        energy DOUBLE PRECISION,
                        mood_json JSONB,
                        danceability DOUBLE PRECISION,
                        valence DOUBLE PRECISION,
                        acousticness DOUBLE PRECISION,
                        instrumentalness DOUBLE PRECISION,
                        loudness DOUBLE PRECISION,
                        dynamic_range DOUBLE PRECISION,
                        spectral_complexity DOUBLE PRECISION
                    )
                )
                UPDATE library_tracks lt
                SET bpm = rows.bpm,
                    audio_key = rows.audio_key,
                    audio_scale = rows.audio_scale,
                    energy = rows.energy,
                    mood_json = rows.mood_json,
                    danceability = rows.danceability,
                    valence = rows.valence,
                    acousticness = rows.acousticness,
                    instrumentalness = rows.instrumentalness,
                    loudness = rows.loudness,
                    dynamic_range = rows.dynamic_range,
                    spectral_complexity = rows.spectral_complexity,
                    analysis_state = 'done',
                    analysis_completed_at = :now
                FROM rows
                WHERE lt.id = rows.track_id
                """
            ),
            {"rows_json": rows_json, "now": now},
        )
        session.execute(
            text(
                """
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
                    rows.track_id,
                    rows.bpm,
                    rows.audio_key,
                    rows.audio_scale,
                    rows.energy,
                    rows.mood_json,
                    rows.danceability,
                    rows.valence,
                    rows.acousticness,
                    rows.instrumentalness,
                    rows.loudness,
                    rows.dynamic_range,
                    rows.spectral_complexity,
                    :updated_at
                FROM jsonb_to_recordset(CAST(:rows_json AS jsonb)) AS rows(
                    track_id INTEGER,
                    bpm DOUBLE PRECISION,
                    audio_key TEXT,
                    audio_scale TEXT,
                    energy DOUBLE PRECISION,
                    mood_json JSONB,
                    danceability DOUBLE PRECISION,
                    valence DOUBLE PRECISION,
                    acousticness DOUBLE PRECISION,
                    instrumentalness DOUBLE PRECISION,
                    loudness DOUBLE PRECISION,
                    dynamic_range DOUBLE PRECISION,
                    spectral_complexity DOUBLE PRECISION
                )
                ON CONFLICT (track_id) DO UPDATE SET
                    bpm = EXCLUDED.bpm,
                    audio_key = EXCLUDED.audio_key,
                    audio_scale = EXCLUDED.audio_scale,
                    energy = EXCLUDED.energy,
                    mood_json = EXCLUDED.mood_json,
                    danceability = EXCLUDED.danceability,
                    valence = EXCLUDED.valence,
                    acousticness = EXCLUDED.acousticness,
                    instrumentalness = EXCLUDED.instrumentalness,
                    loudness = EXCLUDED.loudness,
                    dynamic_range = EXCLUDED.dynamic_range,
                    spectral_complexity = EXCLUDED.spectral_complexity,
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {"rows_json": rows_json, "updated_at": now},
        )
        complete_processing_states(
            session,
            track_ids=[row["track_id"] for row in rows],
            pipeline="analysis",
            completed_at=now,
        )
        for row in rows:
            append_pipeline_event(session, pipeline="analysis", track_id=row["track_id"], state="done")
        mark_ops_snapshot_dirty(session)


__all__ = [
    "mark_done",
    "mark_failed",
    "store_analysis_result",
    "store_analysis_results",
    "store_bliss_vector",
    "store_bliss_vectors",
]
