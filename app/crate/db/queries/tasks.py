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


def _coerce_json_list(value) -> list[dict]:
    if isinstance(value, list):
        return [dict(item) for item in value if isinstance(item, dict)]
    if isinstance(value, str):
        try:
            loaded = json.loads(value)
        except json.JSONDecodeError:
            return []
        if isinstance(loaded, list):
            return [dict(item) for item in loaded if isinstance(item, dict)]
    return []


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


def get_task_activity_snapshot(*, running_limit: int = 100, pending_limit: int = 100, recent_limit: int = 10) -> dict:
    params = {
        "running_limit": max(1, int(running_limit or 1)),
        "pending_limit": max(1, int(pending_limit or 1)),
        "recent_limit": max(1, int(recent_limit or 1)),
    }
    with read_scope() as session:
        row = session.execute(
            text(
                """
                WITH running AS (
                    SELECT *
                    FROM tasks
                    WHERE status IN ('running', 'delegated', 'completing')
                    ORDER BY priority ASC, updated_at DESC
                    LIMIT :running_limit
                ),
                pending AS (
                    SELECT *
                    FROM tasks
                    WHERE status = 'pending'
                    ORDER BY priority ASC, updated_at DESC
                    LIMIT :pending_limit
                ),
                recent AS (
                    SELECT *
                    FROM tasks
                    ORDER BY updated_at DESC
                    LIMIT :recent_limit
                )
                SELECT
                    (SELECT COUNT(*) FROM tasks WHERE status IN ('running', 'delegated', 'completing')) AS running_count,
                    (SELECT COUNT(*) FROM tasks WHERE status = 'pending') AS pending_count,
                    COALESCE(
                        (SELECT jsonb_agg(to_jsonb(running) ORDER BY running.priority ASC, running.updated_at DESC) FROM running),
                        '[]'::jsonb
                    ) AS running_tasks,
                    COALESCE(
                        (SELECT jsonb_agg(to_jsonb(pending) ORDER BY pending.priority ASC, pending.updated_at DESC) FROM pending),
                        '[]'::jsonb
                    ) AS pending_tasks,
                    COALESCE(
                        (SELECT jsonb_agg(to_jsonb(recent) ORDER BY recent.updated_at DESC) FROM recent),
                        '[]'::jsonb
                    ) AS recent_tasks
                """
            ),
            params,
        ).mappings().first()

    row = dict(row or {})
    return {
        "running_count": int(row.get("running_count") or 0),
        "pending_count": int(row.get("pending_count") or 0),
        "running_tasks": [task_row_to_dict(item) for item in _coerce_json_list(row.get("running_tasks"))],
        "pending_tasks": [task_row_to_dict(item) for item in _coerce_json_list(row.get("pending_tasks"))],
        "recent_tasks": [task_row_to_dict(item) for item in _coerce_json_list(row.get("recent_tasks"))],
    }


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
