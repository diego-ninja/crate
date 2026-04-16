"""DB functions for shared worker handler utilities."""

from crate.db.core import get_db_ctx


def get_task_status(task_id: str) -> str | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT status FROM tasks WHERE id = %s", (task_id,))
        row = cur.fetchone()
        return row["status"] if row else None
