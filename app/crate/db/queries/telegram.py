from crate.db.tx import transaction_scope
from sqlalchemy import text


def get_library_status_summary() -> dict:
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                SELECT
                    (SELECT COUNT(*)::INTEGER FROM library_artists) AS artists,
                    (SELECT COUNT(*)::INTEGER FROM library_albums) AS albums,
                    (SELECT COUNT(*)::INTEGER FROM library_tracks) AS tracks,
                    (SELECT COALESCE(SUM(size), 0)::BIGINT FROM library_tracks) AS size_bytes,
                    (SELECT COUNT(*)::INTEGER FROM tasks WHERE status = 'running') AS running,
                    (SELECT COUNT(*)::INTEGER FROM tasks WHERE status = 'pending') AS pending
                """
            )
        ).mappings().first()
    return dict(row) if row else {
        "artists": 0,
        "albums": 0,
        "tracks": 0,
        "size_bytes": 0,
        "running": 0,
        "pending": 0,
    }


def get_server_db_stats() -> dict:
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                SELECT
                    pg_database_size(current_database())::BIGINT AS size_bytes,
                    (
                        SELECT COUNT(*)::INTEGER
                        FROM pg_stat_activity
                        WHERE state = 'active'
                    ) AS active_connections
                """
            )
        ).mappings().first()
    return dict(row) if row else {"size_bytes": 0, "active_connections": 0}


def list_active_tasks(limit: int = 15) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT id, type, status, substring(progress for 120) AS progress,
                       created_at, updated_at
                FROM tasks
                WHERE status IN ('running', 'pending')
                ORDER BY status, created_at
                LIMIT :lim
                """
            ),
            {"lim": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def list_recently_played(limit_minutes: int = 10) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    upe.user_id,
                    u.username,
                    u.display_name,
                    upe.artist,
                    upe.album,
                    upe.title,
                    t.format,
                    t.bit_depth,
                    t.sample_rate,
                    upe.ended_at AS played_at
                FROM user_play_events upe
                LEFT JOIN users u ON u.id = upe.user_id
                LEFT JOIN library_tracks t ON t.id = upe.track_id
                WHERE upe.ended_at > now() - (:minutes * INTERVAL '1 minute')
                ORDER BY upe.ended_at DESC
                """
            ),
            {"minutes": limit_minutes},
        ).mappings().all()
    return [dict(row) for row in rows]


def list_recent_albums(limit: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT DISTINCT ON (a.id)
                    a.artist, a.name, a.year,
                    a.track_count, a.formats_json
                FROM library_albums a
                ORDER BY a.id DESC
                LIMIT :lim
                """
            ),
            {"lim": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def find_active_task_by_prefix(task_id_prefix: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                SELECT id, type, status
                FROM tasks
                WHERE id LIKE :prefix
                  AND status IN ('running', 'pending')
                LIMIT 1
                """
            ),
            {"prefix": f"{task_id_prefix}%"},
        ).mappings().first()
    return dict(row) if row else None
