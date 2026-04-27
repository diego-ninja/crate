"""Status and inventory helpers for analysis pipelines."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import transaction_scope


def get_analysis_status() -> dict:
    """Return current analysis progress for both daemons."""
    with transaction_scope() as session:
        total = int(session.execute(text("SELECT COUNT(*) AS cnt FROM library_tracks")).scalar() or 0)
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
                        COUNT(*) FILTER (WHERE inferred_state = 'done') AS done,
                        COUNT(*) FILTER (WHERE inferred_state = 'pending') AS pending,
                        COUNT(*) FILTER (WHERE inferred_state = 'analyzing') AS analyzing,
                        COUNT(*) FILTER (WHERE inferred_state = 'failed') AS failed
                    FROM (
                        SELECT
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
                                WHEN lt.analysis_state IN ('analyzing', 'failed') THEN lt.analysis_state
                                ELSE 'pending'
                            END AS inferred_state
                        FROM library_tracks lt
                        LEFT JOIN track_analysis_features taf ON taf.track_id = lt.id
                        WHERE NOT EXISTS (
                            SELECT 1
                            FROM track_processing_state ps
                            WHERE ps.track_id = lt.id AND ps.pipeline = 'analysis'
                        )
                    ) missing
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
                        COUNT(*) FILTER (WHERE inferred_state = 'done') AS done,
                        COUNT(*) FILTER (WHERE inferred_state = 'pending') AS pending,
                        COUNT(*) FILTER (WHERE inferred_state = 'analyzing') AS analyzing,
                        COUNT(*) FILTER (WHERE inferred_state = 'failed') AS failed
                    FROM (
                        SELECT
                            CASE
                                WHEN tbe.track_id IS NOT NULL THEN 'done'
                                WHEN lt.bliss_vector IS NOT NULL THEN 'done'
                                WHEN lt.bliss_state IN ('analyzing', 'failed') THEN lt.bliss_state
                                ELSE 'pending'
                            END AS inferred_state
                        FROM library_tracks lt
                        LEFT JOIN track_bliss_embeddings tbe ON tbe.track_id = lt.id
                        WHERE NOT EXISTS (
                            SELECT 1
                            FROM track_processing_state ps
                            WHERE ps.track_id = lt.id AND ps.pipeline = 'bliss'
                        )
                    ) missing
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


def get_artists_needing_analysis() -> set[str]:
    with transaction_scope() as session:
        rows = session.execute(
            text(
                "SELECT al.artist FROM library_tracks t "
                "JOIN library_albums al ON t.album_id = al.id "
                "WHERE t.bpm IS NULL OR t.energy IS NULL "
                "GROUP BY al.artist"
            )
        ).mappings().all()
        return {row["artist"] for row in rows}


def get_artists_needing_bliss() -> set[str]:
    with transaction_scope() as session:
        rows = session.execute(
            text(
                "SELECT al.artist FROM library_tracks t "
                "JOIN library_albums al ON t.album_id = al.id "
                "WHERE t.bliss_vector IS NULL "
                "GROUP BY al.artist"
            )
        ).mappings().all()
        return {row["artist"] for row in rows}


__all__ = [
    "get_analysis_status",
    "get_artists_needing_analysis",
    "get_artists_needing_bliss",
]
