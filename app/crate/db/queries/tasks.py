from __future__ import annotations

import json

from sqlalchemy import text

from crate.db.repositories.tasks_shared import DB_HEAVY_TASKS
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


def _pool_counts_template() -> dict[str, int]:
    return {"fast": 0, "default": 0, "heavy": 0, "maintenance": 0, "playback": 0}


def _coerce_pool_counts(value) -> dict[str, int]:
    counts = _pool_counts_template()
    source = value
    if isinstance(value, str):
        try:
            source = json.loads(value)
        except json.JSONDecodeError:
            return counts
    if isinstance(source, dict):
        for pool in counts:
            counts[pool] = int(source.get(pool) or 0)
    return counts


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
        "db_heavy_types": list(DB_HEAVY_TASKS),
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
                ),
                task_counts AS MATERIALIZED (
                    SELECT
                        COUNT(*) FILTER (
                            WHERE status IN ('running', 'delegated', 'completing')
                        ) AS running_count,
                        COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
                        jsonb_build_object(
                            'fast', COUNT(*) FILTER (
                                WHERE status IN ('running', 'delegated', 'completing') AND pool = 'fast'
                            ),
                            'default', COUNT(*) FILTER (
                                WHERE status IN ('running', 'delegated', 'completing')
                                  AND COALESCE(pool, 'default') = 'default'
                            ),
                            'heavy', COUNT(*) FILTER (
                                WHERE status IN ('running', 'delegated', 'completing') AND pool = 'heavy'
                            ),
                            'maintenance', COUNT(*) FILTER (
                                WHERE status IN ('running', 'delegated', 'completing') AND pool = 'maintenance'
                            ),
                            'playback', COUNT(*) FILTER (
                                WHERE status IN ('running', 'delegated', 'completing') AND pool = 'playback'
                            )
                        ) AS running_by_pool,
                        jsonb_build_object(
                            'fast', COUNT(*) FILTER (WHERE status = 'pending' AND pool = 'fast'),
                            'default', COUNT(*) FILTER (
                                WHERE status = 'pending' AND COALESCE(pool, 'default') = 'default'
                            ),
                            'heavy', COUNT(*) FILTER (WHERE status = 'pending' AND pool = 'heavy'),
                            'maintenance', COUNT(*) FILTER (WHERE status = 'pending' AND pool = 'maintenance'),
                            'playback', COUNT(*) FILTER (WHERE status = 'pending' AND pool = 'playback')
                        ) AS pending_by_pool,
                        COUNT(*) FILTER (
                            WHERE status = 'running' AND type = ANY(:db_heavy_types)
                        ) AS db_heavy_running_count,
                        COUNT(*) FILTER (
                            WHERE status = 'pending' AND type = ANY(:db_heavy_types)
                        ) AS db_heavy_pending_count
                    FROM tasks
                )
                SELECT
                    task_counts.running_count,
                    task_counts.pending_count,
                    task_counts.running_by_pool,
                    task_counts.pending_by_pool,
                    task_counts.db_heavy_running_count,
                    task_counts.db_heavy_pending_count,
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
                FROM task_counts
                """
            ),
            params,
        ).mappings().first()

    row = dict(row or {})
    return {
        "running_count": int(row.get("running_count") or 0),
        "pending_count": int(row.get("pending_count") or 0),
        "queue_breakdown": {
            "running": _coerce_pool_counts(row.get("running_by_pool")),
            "pending": _coerce_pool_counts(row.get("pending_by_pool")),
        },
        "db_heavy_gate": {
            "active": int(row.get("db_heavy_running_count") or 0),
            "pending": int(row.get("db_heavy_pending_count") or 0),
            "blocking": int(row.get("db_heavy_running_count") or 0) > 0 and int(row.get("db_heavy_pending_count") or 0) > 0,
        },
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


def has_inflight_acquisition_for_artist(artist_name: str, *, exclude_task_id: str | None = None) -> bool:
    """Return True when another acquisition task for this artist is still active."""
    if not artist_name.strip():
        return False

    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT EXISTS(
                    SELECT 1
                    FROM tasks
                    WHERE type IN ('tidal_download', 'soulseek_download')
                      AND status IN ('pending', 'running', 'delegated', 'completing')
                      AND LOWER(COALESCE(params_json->>'artist', '')) = LOWER(:artist)
                      AND (:exclude_task_id = '' OR id <> :exclude_task_id)
                ) AS has_active
                """
            ),
            {
                "artist": artist_name,
                "exclude_task_id": exclude_task_id or "",
            },
        ).mappings().first()
    return bool(row and row.get("has_active"))


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
