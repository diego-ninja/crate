import uuid
import json
from datetime import datetime, timezone
from musicdock.db.core import get_db_ctx

# ── Task CRUD ─────────────────────────────────────────────────────

def create_task(task_type: str, params: dict | None = None) -> str:
    task_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO tasks (id, type, status, params_json, created_at, updated_at) VALUES (%s, %s, 'pending', %s, %s, %s)",
            (task_id, task_type, json.dumps(params or {}), now, now),
        )
    return task_id


def update_task(task_id: str, *, status: str | None = None, progress: str | None = None,
                result: dict | None = None, error: str | None = None):
    now = datetime.now(timezone.utc).isoformat()
    fields = ["updated_at = %s"]
    values: list = [now]

    if status is not None:
        fields.append("status = %s")
        values.append(status)
    if progress is not None:
        fields.append("progress = %s")
        values.append(progress)
    if result is not None:
        fields.append("result_json = %s")
        values.append(json.dumps(result))
    if error is not None:
        fields.append("error = %s")
        values.append(error)

    values.append(task_id)
    with get_db_ctx() as cur:
        cur.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id = %s", values)


def get_task(task_id: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM tasks WHERE id = %s", (task_id,))
        row = cur.fetchone()
    return _row_to_task(row) if row else None


def list_tasks(status: str | None = None, task_type: str | None = None, limit: int = 50) -> list[dict]:
    query = "SELECT * FROM tasks WHERE 1=1"
    params: list = []
    if status:
        query += " AND status = %s"
        params.append(status)
    if task_type:
        query += " AND type = %s"
        params.append(task_type)
    query += " ORDER BY created_at DESC LIMIT %s"
    params.append(limit)

    with get_db_ctx() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()
    return [_row_to_task(r) for r in rows]


def claim_next_task() -> dict | None:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM tasks WHERE status = 'pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED"
        )
        row = cur.fetchone()
        if not row:
            return None
        now = datetime.now(timezone.utc).isoformat()
        cur.execute(
            "UPDATE tasks SET status = 'running', updated_at = %s WHERE id = %s AND status = 'pending'",
            (now, row["id"]),
        )
    return _row_to_task(row) if row else None


def _row_to_task(row: dict) -> dict:
    d = dict(row)
    params_raw = d.pop("params_json", {})
    d["params"] = params_raw if isinstance(params_raw, dict) else json.loads(params_raw or "{}")
    result_raw = d.pop("result_json", None)
    d["result"] = result_raw if isinstance(result_raw, (dict, list)) else (json.loads(result_raw) if result_raw else None)
    return d


# ── Scan results ──────────────────────────────────────────────────

def save_scan_result(task_id: str, issues: list[dict]):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO scan_results (task_id, issues_json, scanned_at) VALUES (%s, %s, %s)",
            (task_id, json.dumps(issues), now),
        )


def get_latest_scan() -> dict | None:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM scan_results ORDER BY scanned_at DESC LIMIT 1"
        )
        row = cur.fetchone()
    if not row:
        return None
    d = dict(row)
    issues_raw = d.pop("issues_json")
    d["issues"] = issues_raw if isinstance(issues_raw, list) else json.loads(issues_raw)
    return d


