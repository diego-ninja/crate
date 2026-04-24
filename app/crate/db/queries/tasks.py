from __future__ import annotations

import json

from sqlalchemy import text

from crate.db.tx import read_scope


def task_row_to_dict(row: dict) -> dict:
    from crate.task_registry import task_icon, task_label

    item = dict(row)
    params_raw = item.pop("params_json", {})
    item["params"] = params_raw if isinstance(params_raw, dict) else json.loads(params_raw or "{}")
    result_raw = item.pop("result_json", None)
    item["result"] = result_raw if isinstance(result_raw, (dict, list)) else (json.loads(result_raw) if result_raw else None)
    item["label"] = task_label(item.get("type", ""))
    item["icon"] = task_icon(item.get("type", ""))
    return item


def get_task(task_id: str) -> dict | None:
    with read_scope() as session:
        row = session.execute(
            text("SELECT * FROM tasks WHERE id = :id"),
            {"id": task_id},
        ).mappings().first()
    return task_row_to_dict(row) if row else None


def list_tasks(status: str | None = None, task_type: str | None = None, limit: int = 50) -> list[dict]:
    query = "SELECT * FROM tasks WHERE 1=1"
    params: dict[str, object] = {}
    if status:
        if status == "running":
            query += " AND status IN ('running', 'delegated', 'completing')"
        else:
            query += " AND status = :status"
            params["status"] = status
    if task_type:
        query += " AND type = :task_type"
        params["task_type"] = task_type
    query += (
        " ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'delegated' THEN 0 WHEN 'completing' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,"
        " CASE WHEN status IN ('running','pending','delegated','completing') THEN priority ELSE 999 END ASC,"
        " updated_at DESC LIMIT :lim"
    )
    params["lim"] = limit

    with read_scope() as session:
        rows = session.execute(text(query), params).mappings().all()
    return [task_row_to_dict(row) for row in rows]


def list_child_tasks(parent_task_id: str) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text("SELECT * FROM tasks WHERE parent_task_id = :parent_id ORDER BY created_at"),
            {"parent_id": parent_task_id},
        ).mappings().all()
    return [task_row_to_dict(row) for row in rows]


def get_latest_scan() -> dict | None:
    with read_scope() as session:
        row = session.execute(
            text("SELECT * FROM scan_results ORDER BY scanned_at DESC LIMIT 1")
        ).mappings().first()
    if not row:
        return None
    item = dict(row)
    issues_raw = item.pop("issues_json")
    item["issues"] = issues_raw if isinstance(issues_raw, list) else json.loads(issues_raw)
    return item
