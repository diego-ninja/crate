"""DB functions for shared worker handler utilities."""

from crate.db.tx import transaction_scope
from sqlalchemy import text


def get_task_status(task_id: str) -> str | None:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT status FROM tasks WHERE id = :id"),
            {"id": task_id},
        ).mappings().first()
        return row["status"] if row else None
