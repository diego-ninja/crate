"""Database queries for analysis_daemon — background analysis state management.

Uses FOR UPDATE SKIP LOCKED for atomic claim queries — keep exactly as-is.
"""

import os
import socket
from datetime import datetime, timezone

from crate.db.bliss_vectors import to_pgvector_literal
from sqlalchemy import text

from crate.db.domain_events import append_domain_event
from crate.db.tx import transaction_scope
from crate.db.ui_snapshot_store import mark_ui_snapshots_stale


def claim_track(state_column: str) -> dict | None:
    """Backward-compatible single-track claim helper."""
    tracks = claim_tracks(state_column, limit=1)
    return tracks[0] if tracks else None


def claim_tracks(state_column: str, *, limit: int = 1) -> list[dict]:
    """Atomically claim the next pending batch for processing.

    Uses track_processing_state as the authoritative claim queue, while
    mirroring state back into legacy library_tracks columns during the cutover.
    """
    col = _validate_state_column(state_column)
    pipeline = _pipeline_name_for_state_column(col)
    batch_size = max(1, min(int(limit or 1), 200))
    claimed_at = datetime.now(timezone.utc).isoformat()
    claimed_by = f"{os.environ.get('CRATE_RUNTIME', 'runtime')}:{socket.gethostname()}"
    with transaction_scope() as session:
        _ensure_processing_rows(session, pipeline=pipeline, limit=max(batch_size * 8, batch_size))
        pending = session.execute(
            text(_processing_pending_exists_sql(col)),
            {"pipeline": pipeline},
        ).scalar()
        if not pending:
            return []
        rows = session.execute(
            text(_claim_batch_sql(col)),
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
                _append_pipeline_event(
                    session,
                    pipeline=pipeline,
                    track_id=int(row["id"]),
                    state="analyzing",
                )
            _mark_ops_snapshot_dirty(session)
        return [dict(row) for row in rows]


_ALLOWED_STATE_COLUMNS = frozenset({"analysis_state", "bliss_state"})


def _validate_state_column(state_column: str) -> str:
    if state_column not in _ALLOWED_STATE_COLUMNS:
        raise ValueError(f"Invalid state column: {state_column!r}")
    return state_column


def _build_claim_predicate(state_column: str) -> str:
    if state_column == "bliss_state":
        return (
            "bliss_state = 'pending' "
            "AND path IS NOT NULL "
            "AND COALESCE(analysis_state, 'pending') != 'analyzing'"
        )
    return f"{state_column} = 'pending' AND path IS NOT NULL"


def _pipeline_name_for_state_column(state_column: str) -> str:
    return "bliss" if state_column == "bliss_state" else "analysis"


def mark_done(track_id: int, state_column: str):
    col = _validate_state_column(state_column)
    now = datetime.now(timezone.utc).isoformat()
    extra_set = ""
    if col == "analysis_state":
        extra_set = ", analysis_completed_at = :now"
    elif col == "bliss_state":
        extra_set = ", bliss_computed_at = :now"
    with transaction_scope() as session:
        session.execute(
            text(f"UPDATE library_tracks SET {col} = 'done'{extra_set} WHERE id = :id"),
            {"now": now, "id": track_id},
        )
        _complete_processing_state(
            session,
            track_id=track_id,
            pipeline=_pipeline_name_for_state_column(col),
            completed_at=now,
        )
        _mark_ops_snapshot_dirty(session)
        _append_pipeline_event(
            session,
            pipeline=_pipeline_name_for_state_column(col),
            track_id=track_id,
            state="done",
        )


def mark_failed(track_id: int, state_column: str, error_message: str | None = None):
    col = _validate_state_column(state_column)
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
                "pipeline": _pipeline_name_for_state_column(col),
                "last_error": error_message,
            },
        )
        _mark_ops_snapshot_dirty(session)
        _append_pipeline_event(
            session,
            pipeline=_pipeline_name_for_state_column(col),
            track_id=track_id,
            state="failed",
            error_message=error_message,
        )


def release_claims(track_ids: list[int], state_column: str) -> int:
    col = _validate_state_column(state_column)
    cleaned = [int(track_id) for track_id in track_ids if track_id]
    if not cleaned:
        return 0
    pipeline = _pipeline_name_for_state_column(col)
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
            _mark_ops_snapshot_dirty(session)
        return int(result.rowcount or 0)


def reset_stale_claims(state_column: str) -> int:
    """On startup, reset any tracks stuck in 'analyzing' state from a previous crash.
    Returns the number of rows reset."""
    col = _validate_state_column(state_column)
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
            {"pipeline": _pipeline_name_for_state_column(col)},
        )
        if result.rowcount:
            _mark_ops_snapshot_dirty(session)
        return result.rowcount


def get_pending_count(state_column: str) -> int:
    col = _validate_state_column(state_column)
    pipeline = _pipeline_name_for_state_column(col)
    with transaction_scope() as session:
        _ensure_processing_rows(session, pipeline=pipeline, limit=2000)
        row = session.execute(
            text(_processing_pending_count_sql(col)),
            {"pipeline": pipeline},
        ).mappings().first()
        return row["cnt"]


def store_bliss_vector(track_id: int, vector: list[float]):
    """Store a bliss vector and mark as done in one update."""
    store_bliss_vectors({track_id: vector})


def store_bliss_vectors(vectors_by_track_id: dict[int, list[float]]) -> None:
    """Persist multiple bliss vectors in a single transaction."""
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
            _complete_processing_state(
                session,
                track_id=track_id,
                pipeline="bliss",
                completed_at=now,
            )
            _append_pipeline_event(session, pipeline="bliss", track_id=track_id, state="done")
        _mark_ops_snapshot_dirty(session)


def store_analysis_result(track_id: int, path: str, result: dict) -> None:
    """Persist computed audio analysis and pipeline completion in one transaction."""
    store_analysis_results([(track_id, path, result)])


def store_analysis_results(results: list[tuple[int, str, dict]]) -> None:
    """Persist multiple audio analysis results in a single transaction."""
    if not results:
        return

    now = datetime.now(timezone.utc).isoformat()

    from crate.db.repositories.library import update_track_analysis

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
            _complete_processing_state(
                session,
                track_id=track_id,
                pipeline="analysis",
                completed_at=now,
            )
            _append_pipeline_event(session, pipeline="analysis", track_id=track_id, state="done")
        _mark_ops_snapshot_dirty(session)


def get_analysis_status() -> dict:
    """Return current analysis progress for both daemons."""
    with transaction_scope() as session:
        total = int(
            session.execute(text("SELECT COUNT(*) AS cnt FROM library_tracks")).scalar() or 0
        )
        rows = session.execute(
            text(
                """
                SELECT pipeline, state, COUNT(*) AS cnt
                FROM track_processing_state
                GROUP BY pipeline, state
                """
            )
        ).mappings().all()
        counts: dict[str, dict[str, int]] = {
            "analysis": {"done": 0, "pending": 0, "analyzing": 0, "failed": 0},
            "bliss": {"done": 0, "pending": 0, "analyzing": 0, "failed": 0},
        }
        coverage = {"analysis": 0, "bliss": 0}
        for row in rows:
            pipeline = row["pipeline"]
            state = row["state"]
            if pipeline in counts and state in counts[pipeline]:
                counts[pipeline][state] = int(row["cnt"] or 0)
                coverage[pipeline] += int(row["cnt"] or 0)

        if coverage["analysis"] < total:
            missing = session.execute(
                text(
                    """
                    SELECT
                        COUNT(*) FILTER (WHERE analysis_state = 'done') AS done,
                        COUNT(*) FILTER (WHERE analysis_state = 'pending') AS pending,
                        COUNT(*) FILTER (WHERE analysis_state = 'analyzing') AS analyzing,
                        COUNT(*) FILTER (WHERE analysis_state = 'failed') AS failed
                    FROM library_tracks lt
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM track_processing_state ps
                        WHERE ps.track_id = lt.id AND ps.pipeline = 'analysis'
                    )
                    """
                )
            ).mappings().first()
            if missing:
                for state in counts["analysis"]:
                    counts["analysis"][state] += int(missing[state] or 0)

        if coverage["bliss"] < total:
            missing = session.execute(
                text(
                    """
                    SELECT
                        COUNT(*) FILTER (WHERE bliss_state = 'done') AS done,
                        COUNT(*) FILTER (WHERE bliss_state = 'pending') AS pending,
                        COUNT(*) FILTER (WHERE bliss_state = 'analyzing') AS analyzing,
                        COUNT(*) FILTER (WHERE bliss_state = 'failed') AS failed
                    FROM library_tracks lt
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM track_processing_state ps
                        WHERE ps.track_id = lt.id AND ps.pipeline = 'bliss'
                    )
                    """
                )
            ).mappings().first()
            if missing:
                for state in counts["bliss"]:
                    counts["bliss"][state] += int(missing[state] or 0)

        return {
            "total": total,
            "analysis_done": counts["analysis"]["done"],
            "analysis_pending": counts["analysis"]["pending"],
            "analysis_active": counts["analysis"]["analyzing"],
            "analysis_failed": counts["analysis"]["failed"],
            "bliss_done": counts["bliss"]["done"],
            "bliss_pending": counts["bliss"]["pending"],
            "bliss_active": counts["bliss"]["analyzing"],
            "bliss_failed": counts["bliss"]["failed"],
        }


# ── Worker handler queries ───────────────────────────────────────


def get_artists_needing_analysis() -> set[str]:
    with transaction_scope() as session:
        rows = session.execute(text(
            "SELECT al.artist FROM library_tracks t "
            "JOIN library_albums al ON t.album_id = al.id "
            "WHERE t.bpm IS NULL OR t.energy IS NULL "
            "GROUP BY al.artist"
        )).mappings().all()
        return {row["artist"] for row in rows}


def get_artists_needing_bliss() -> set[str]:
    with transaction_scope() as session:
        rows = session.execute(text(
            "SELECT al.artist FROM library_tracks t "
            "JOIN library_albums al ON t.album_id = al.id "
            "WHERE t.bliss_vector IS NULL "
            "GROUP BY al.artist"
        )).mappings().all()
        return {row["artist"] for row in rows}


def get_albums_needing_popularity(artist_name: str) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT id, name, tag_album FROM library_albums "
                 "WHERE artist = :artist AND lastfm_listeners IS NULL"),
            {"artist": artist_name},
        ).mappings().all()
        return [dict(row) for row in rows]


def update_album_popularity(album_id: int, listeners: int, playcount: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET lastfm_listeners = :listeners, lastfm_playcount = :playcount "
                 "WHERE id = :id"),
            {"listeners": listeners, "playcount": playcount, "id": album_id},
        )


def get_tracks_needing_popularity(artist_name: str, limit: int = 50) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT t.id, t.title FROM library_tracks t "
                 "JOIN library_albums a ON t.album_id = a.id "
                 "WHERE a.artist = :artist AND t.lastfm_listeners IS NULL "
                 "AND t.title IS NOT NULL AND t.title != '' LIMIT :lim"),
            {"artist": artist_name, "lim": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


def update_track_popularity(track_id: int, listeners: int, playcount: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_tracks SET lastfm_listeners = :listeners, lastfm_playcount = :playcount "
                 "WHERE id = :id"),
            {"listeners": listeners, "playcount": playcount, "id": track_id},
        )


def requeue_tracks(set_clause: str, track_id: int | None = None,
                   album_id: int | None = None, artist: str | None = None,
                   album_name: str | None = None, scope: str | None = None,
                   pipelines: list[str] | None = None) -> int:
    with transaction_scope() as session:
        if track_id:
            result = session.execute(text(f"UPDATE library_tracks SET {set_clause} WHERE id = :id"), {"id": track_id})
        elif album_id:
            result = session.execute(text(f"UPDATE library_tracks SET {set_clause} WHERE album_id = :album_id"), {"album_id": album_id})
        elif artist and album_name:
            result = session.execute(
                text(f"UPDATE library_tracks SET {set_clause} WHERE album_id IN "
                     "(SELECT id FROM library_albums WHERE artist = :artist AND name = :album_name)"),
                {"artist": artist, "album_name": album_name},
            )
        elif artist:
            result = session.execute(
                text(f"UPDATE library_tracks SET {set_clause} WHERE album_id IN "
                     "(SELECT id FROM library_albums WHERE artist = :artist)"),
                {"artist": artist},
            )
        elif scope == "all":
            result = session.execute(text(f"UPDATE library_tracks SET {set_clause}"))
        else:
            return 0
        if result.rowcount and pipelines:
            filters = _requeue_filter_clauses(
                track_id=track_id,
                album_id=album_id,
                artist=artist,
                album_name=album_name,
                scope=scope,
            )
            for pipeline in pipelines:
                session.execute(
                    text(
                        f"""
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
                            id,
                            :pipeline,
                            'pending',
                            NULL,
                            NULL,
                            0,
                            NULL,
                            NOW(),
                            NULL
                        FROM library_tracks
                        WHERE {filters}
                        ON CONFLICT (track_id, pipeline) DO UPDATE SET
                            state = 'pending',
                            claimed_by = NULL,
                            claimed_at = NULL,
                            last_error = NULL,
                            updated_at = NOW(),
                            completed_at = NULL
                        """
                    ),
                    {"pipeline": pipeline, **_requeue_filter_params(track_id, album_id, artist, album_name)},
                )
                _append_pipeline_event(
                    session,
                    pipeline=pipeline,
                    track_id=track_id,
                    state="pending",
                )
            _mark_ops_snapshot_dirty(session)
        return result.rowcount


def backfill_pipeline_read_models(*, limit: int = 1000) -> dict[str, int]:
    """Incrementally backfill shadow pipeline tables from legacy hot columns."""
    batch_size = max(1, min(int(limit or 1000), 5000))
    with transaction_scope() as session:
        analysis_state_inserted = int(
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
                {"limit": batch_size},
            ).scalar()
            or 0
        )
        bliss_state_inserted = int(
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
                {"limit": batch_size},
            ).scalar()
            or 0
        )
        analysis_features_inserted = int(
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
                {"limit": batch_size},
            ).scalar()
            or 0
        )
        bliss_embeddings_inserted = int(
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
                {"limit": batch_size},
            ).scalar()
            or 0
        )
        inserted_total = (
            analysis_state_inserted
            + bliss_state_inserted
            + analysis_features_inserted
            + bliss_embeddings_inserted
        )
        if inserted_total:
            _mark_ops_snapshot_dirty(session)
    return {
        "processing_analysis": analysis_state_inserted,
        "processing_bliss": bliss_state_inserted,
        "analysis_features": analysis_features_inserted,
        "bliss_embeddings": bliss_embeddings_inserted,
    }


def _complete_processing_state(session, *, track_id: int, pipeline: str, completed_at: str) -> None:
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


def _mark_ops_snapshot_dirty(session) -> None:
    mark_ui_snapshots_stale(scope="ops", subject_key="dashboard", session=session)


def _append_pipeline_event(
    session,
    *,
    pipeline: str,
    track_id: int | None,
    state: str,
    error_message: str | None = None,
) -> None:
    event_type = "track.bliss.updated" if pipeline == "bliss" else "track.analysis.updated"
    append_domain_event(
        event_type,
        {
            "track_id": track_id,
            "pipeline": pipeline,
            "state": state,
            "error": error_message,
        },
        scope=f"pipeline:{pipeline}",
        subject_key=str(track_id) if track_id else pipeline,
        session=session,
    )


def _ensure_processing_rows(session, *, pipeline: str, limit: int) -> None:
    if pipeline not in {"analysis", "bliss"}:
        raise ValueError(f"Invalid pipeline: {pipeline!r}")

    state_column = "analysis_state" if pipeline == "analysis" else "bliss_state"
    completed_column = "analysis_completed_at" if pipeline == "analysis" else "bliss_computed_at"

    session.execute(
        text(
            f"""
            WITH batch AS (
                SELECT
                    lt.id AS track_id,
                    CASE
                        WHEN {state_column} IN ('pending', 'analyzing', 'done', 'failed') THEN {state_column}
                        ELSE 'pending'
                    END AS state,
                    CASE
                        WHEN {state_column} = 'done' THEN COALESCE({completed_column}, lt.updated_at, NOW())
                        ELSE NULL
                    END AS completed_at
                FROM library_tracks lt
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


def _processing_pending_exists_sql(state_column: str) -> str:
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
                  AND COALESCE(lt.analysis_state, 'pending') != 'analyzing'
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


def _processing_pending_count_sql(state_column: str) -> str:
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
              AND COALESCE(lt.analysis_state, 'pending') != 'analyzing'
        """
    return """
        SELECT COUNT(*) AS cnt
        FROM track_processing_state ps
        JOIN library_tracks lt ON lt.id = ps.track_id
        WHERE ps.pipeline = :pipeline
          AND ps.state = 'pending'
          AND lt.path IS NOT NULL
    """


def _claim_batch_sql(state_column: str) -> str:
    if state_column == "bliss_state":
        extra_join = """
            LEFT JOIN track_processing_state aps
              ON aps.track_id = lt.id
             AND aps.pipeline = 'analysis'
        """
        extra_where = (
            "AND COALESCE(aps.state, 'pending') != 'analyzing' "
            "AND COALESCE(lt.analysis_state, 'pending') != 'analyzing'"
        )
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


def _requeue_filter_clauses(
    *,
    track_id: int | None,
    album_id: int | None,
    artist: str | None,
    album_name: str | None,
    scope: str | None,
) -> str:
    if track_id:
        return "id = :track_id"
    if album_id:
        return "album_id = :album_id"
    if artist and album_name:
        return "album_id IN (SELECT id FROM library_albums WHERE artist = :artist AND name = :album_name)"
    if artist:
        return "album_id IN (SELECT id FROM library_albums WHERE artist = :artist)"
    if scope == "all":
        return "TRUE"
    return "FALSE"


def _requeue_filter_params(
    track_id: int | None,
    album_id: int | None,
    artist: str | None,
    album_name: str | None,
) -> dict:
    return {
        "track_id": track_id,
        "album_id": album_id,
        "artist": artist,
        "album_name": album_name,
    }
