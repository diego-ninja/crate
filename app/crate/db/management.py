from sqlalchemy import text

from crate.db.tx import transaction_scope


def get_last_analyzed_track() -> dict:
    with transaction_scope() as session:
        row = session.execute(text("""
            SELECT title, artist, album, bpm, audio_key, energy, danceability,
                   mood_json IS NOT NULL as has_mood, updated_at
            FROM library_tracks
            WHERE analysis_state = 'done' AND bpm IS NOT NULL
            ORDER BY updated_at DESC LIMIT 1
        """)).mappings().first()
    return dict(row) if row else {}


def get_last_bliss_track() -> dict:
    with transaction_scope() as session:
        row = session.execute(text("""
            SELECT title, artist, album, updated_at
            FROM library_tracks
            WHERE bliss_state = 'done' AND bliss_vector IS NOT NULL
            ORDER BY updated_at DESC LIMIT 1
        """)).mappings().first()
    return dict(row) if row else {}


def get_storage_v2_status() -> dict:
    with transaction_scope() as session:
        artist_stats = dict(session.execute(text("""
            SELECT
                COUNT(*) AS total_artists,
                COUNT(*) FILTER (WHERE storage_id IS NOT NULL AND folder_name = storage_id::text) AS migrated_artists
            FROM library_artists
        """)).mappings().first())

        album_stats = dict(session.execute(text("""
            SELECT
                COUNT(*) AS total_albums,
                COUNT(*) FILTER (
                    WHERE storage_id IS NOT NULL
                    AND path LIKE '%/' || storage_id::text
                ) AS migrated_albums
            FROM library_albums
        """)).mappings().first())

        track_stats = dict(session.execute(text("""
            SELECT
                COUNT(*) AS total_tracks,
                COUNT(*) FILTER (
                    WHERE storage_id IS NOT NULL
                    AND filename = storage_id::text || SUBSTRING(filename FROM '\\.[^.]+$')
                ) AS migrated_tracks
            FROM library_tracks
        """)).mappings().first())

    return {**artist_stats, **album_stats, **track_stats}


def count_recent_active_users(window_minutes: int = 5) -> int:
    with transaction_scope() as session:
        row = session.execute(
            text("""
                SELECT COUNT(DISTINCT user_id)::INTEGER AS cnt
                FROM play_history
                WHERE played_at > now() - (:window_minutes * interval '1 minute')
            """),
            {"window_minutes": max(window_minutes, 0)},
        ).mappings().first()
    return int(row["cnt"]) if row else 0


def count_recent_streams(window_minutes: int = 3) -> int:
    with transaction_scope() as session:
        row = session.execute(
            text("""
                SELECT COUNT(*)::INTEGER AS cnt
                FROM play_history
                WHERE played_at > now() - (:window_minutes * interval '1 minute')
            """),
            {"window_minutes": max(window_minutes, 0)},
        ).mappings().first()
    return int(row["cnt"]) if row else 0


def upsert_metric_rollup(
    *,
    name: str,
    tags_json: str,
    period: str,
    bucket_start: str,
    count: int,
    sum_value: float,
    min_value: float,
    max_value: float,
    avg_value: float,
):
    with transaction_scope() as session:
        session.execute(
            text("""
                INSERT INTO metric_rollups (name, tags_json, period, bucket_start, count, sum_value, min_value, max_value, avg_value)
                VALUES (:name, :tags::jsonb, :period, :bucket_start, :count, :sum, :min, :max, :avg)
                ON CONFLICT (name, tags_json, period, bucket_start)
                DO UPDATE SET
                    count = metric_rollups.count + EXCLUDED.count,
                    sum_value = metric_rollups.sum_value + EXCLUDED.sum_value,
                    min_value = LEAST(metric_rollups.min_value, EXCLUDED.min_value),
                    max_value = GREATEST(metric_rollups.max_value, EXCLUDED.max_value),
                    avg_value = (metric_rollups.sum_value + EXCLUDED.sum_value) / NULLIF(metric_rollups.count + EXCLUDED.count, 0)
            """),
            {
                "name": name,
                "tags": tags_json,
                "period": period,
                "bucket_start": bucket_start,
                "count": count,
                "sum": sum_value,
                "min": min_value,
                "max": max_value,
                "avg": avg_value,
            },
        )


def query_metric_rollups(
    *,
    name: str,
    period: str = "hour",
    start: str | None = None,
    end: str | None = None,
    limit: int = 168,
) -> list[dict]:
    query = "SELECT * FROM metric_rollups WHERE name = :name AND period = :period"
    params: dict = {"name": name, "period": period, "limit": limit}

    if start:
        query += " AND bucket_start >= :start"
        params["start"] = start
    if end:
        query += " AND bucket_start <= :end"
        params["end"] = end

    query += " ORDER BY bucket_start DESC LIMIT :limit"

    with transaction_scope() as session:
        rows = session.execute(text(query), params).mappings().all()
    return [dict(row) for row in rows]
