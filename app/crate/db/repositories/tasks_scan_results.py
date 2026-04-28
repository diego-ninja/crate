from __future__ import annotations

from sqlalchemy import text

from crate.db.repositories.tasks_mutation_shared import utc_now_iso
from crate.db.tx import optional_scope


def save_scan_result(task_id: str, issues: list[dict], *, session=None, dumps_fn):
    with optional_scope(session) as s:
        s.execute(
            text("INSERT INTO scan_results (task_id, issues_json, scanned_at) VALUES (:task_id, :issues_json, :scanned_at)"),
            {
                "task_id": task_id,
                "issues_json": dumps_fn(issues),
                "scanned_at": utc_now_iso(),
            },
        )


__all__ = ["save_scan_result"]
