from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.queries.tasks import task_row_to_dict
from crate.db.repositories.tasks_shared import DB_HEAVY_TASKS, register_tasks_surface_signal
from crate.db.tx import transaction_scope


def claim_next_task(max_running: int = 5, *, worker_id: str | None = None) -> dict | None:
    with transaction_scope() as session:
        register_tasks_surface_signal(session)
        row = session.execute(text("SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'running'")).mappings().first()
        running_count = row["cnt"]
        if running_count >= max_running:
            return None

        row = session.execute(
            text("SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'running' AND type = ANY(:heavy)"),
            {"heavy": list(DB_HEAVY_TASKS)},
        ).mappings().first()
        db_heavy_running = row["cnt"] > 0

        if db_heavy_running:
            row = session.execute(
                text(
                    """
                    SELECT * FROM tasks WHERE status = 'pending' AND type != ALL(:heavy)
                    ORDER BY priority ASC, created_at LIMIT 1 FOR UPDATE SKIP LOCKED
                    """
                ),
                {"heavy": list(DB_HEAVY_TASKS)},
            ).mappings().first()
        else:
            row = session.execute(
                text(
                    """
                    SELECT * FROM tasks WHERE status = 'pending'
                    ORDER BY priority ASC, created_at LIMIT 1 FOR UPDATE SKIP LOCKED
                    """
                )
            ).mappings().first()

        if not row:
            return None

        session.execute(
            text(
                """
                UPDATE tasks
                SET status = 'running',
                    started_at = COALESCE(started_at, :now),
                    updated_at = :now,
                    heartbeat_at = :now,
                    worker_id = :worker_id
                WHERE id = :id
                  AND status = 'pending'
                """
            ),
            {"now": datetime.now(timezone.utc).isoformat(), "worker_id": worker_id, "id": row["id"]},
        )
    return task_row_to_dict(row) if row else None


__all__ = ["claim_next_task"]
