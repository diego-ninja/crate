from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_last_analyzed_track() -> dict:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT
                    t.title,
                    t.artist,
                    t.album,
                    f.bpm,
                    f.audio_key,
                    f.energy,
                    f.danceability,
                    f.mood_json IS NOT NULL as has_mood,
                    f.updated_at
                FROM track_analysis_features f
                JOIN library_tracks t ON t.id = f.track_id
                ORDER BY f.updated_at DESC NULLS LAST
                LIMIT 1
                """
            )
        ).mappings().first()
        if not row:
            row = session.execute(
                text(
                    """
                    SELECT
                        title,
                        artist,
                        album,
                        bpm,
                        audio_key,
                        energy,
                        danceability,
                        mood_json IS NOT NULL as has_mood,
                        COALESCE(analysis_completed_at, updated_at) AS updated_at
                    FROM library_tracks
                    WHERE analysis_state = 'done' AND bpm IS NOT NULL
                    ORDER BY COALESCE(analysis_completed_at, updated_at) DESC NULLS LAST
                    LIMIT 1
                    """
                )
            ).mappings().first()
    return dict(row) if row else {}


def get_last_bliss_track() -> dict:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT
                    t.title,
                    t.artist,
                    t.album,
                    b.updated_at
                FROM track_bliss_embeddings b
                JOIN library_tracks t ON t.id = b.track_id
                ORDER BY b.updated_at DESC NULLS LAST
                LIMIT 1
                """
            )
        ).mappings().first()
        if not row:
            row = session.execute(
                text(
                    """
                    SELECT
                        title,
                        artist,
                        album,
                        COALESCE(bliss_computed_at, updated_at) AS updated_at
                    FROM library_tracks
                    WHERE bliss_state = 'done' AND bliss_vector IS NOT NULL
                    ORDER BY COALESCE(bliss_computed_at, updated_at) DESC NULLS LAST
                    LIMIT 1
                    """
                )
            ).mappings().first()
    return dict(row) if row else {}


def get_storage_v2_status() -> dict:
    with read_scope() as session:
        artist_stats = dict(
            session.execute(
                text(
                    """
                    SELECT
                        COUNT(*) AS total_artists,
                        COUNT(*) FILTER (WHERE storage_id IS NOT NULL AND folder_name = storage_id::text) AS migrated_artists
                    FROM library_artists
                    """
                )
            ).mappings().first()
        )
        album_stats = dict(
            session.execute(
                text(
                    """
                    SELECT
                        COUNT(*) AS total_albums,
                        COUNT(*) FILTER (
                            WHERE storage_id IS NOT NULL
                            AND path LIKE '%/' || storage_id::text
                        ) AS migrated_albums
                    FROM library_albums
                    """
                )
            ).mappings().first()
        )
        track_stats = dict(
            session.execute(
                text(
                    """
                    SELECT
                        COUNT(*) AS total_tracks,
                        COUNT(*) FILTER (
                            WHERE storage_id IS NOT NULL
                            AND filename = storage_id::text || SUBSTRING(filename FROM '\\.[^.]+$')
                        ) AS migrated_tracks
                    FROM library_tracks
                    """
                )
            ).mappings().first()
        )
    return {**artist_stats, **album_stats, **track_stats}


def count_recent_active_users(window_minutes: int = 5) -> int:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT COUNT(DISTINCT user_id)::INTEGER AS cnt
                FROM play_history
                WHERE played_at > now() - (:window_minutes * interval '1 minute')
                """
            ),
            {"window_minutes": max(window_minutes, 0)},
        ).mappings().first()
    return int(row["cnt"]) if row else 0


def count_recent_streams(window_minutes: int = 3) -> int:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT COUNT(*)::INTEGER AS cnt
                FROM play_history
                WHERE played_at > now() - (:window_minutes * interval '1 minute')
                """
            ),
            {"window_minutes": max(window_minutes, 0)},
        ).mappings().first()
    return int(row["cnt"]) if row else 0


def query_metric_rollups(
    *,
    name: str,
    period: str = "hour",
    start: str | None = None,
    end: str | None = None,
    limit: int = 168,
) -> list[dict]:
    query = "SELECT * FROM metric_rollups WHERE name = :name AND period = :period"
    params: dict[str, object] = {"name": name, "period": period, "limit": limit}

    if start:
        query += " AND bucket_start >= :start"
        params["start"] = start
    if end:
        query += " AND bucket_start <= :end"
        params["end"] = end

    query += " ORDER BY bucket_start DESC LIMIT :limit"

    with read_scope() as session:
        rows = session.execute(text(query), params).mappings().all()
    return [dict(row) for row in rows]
