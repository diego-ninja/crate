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


def create_task_dedup(task_type: str, params: dict | None = None, dedup_key: str = "") -> str | None:
    """Create a task only if no pending/running task of the same type+key exists.
    Atomic check+insert to prevent TOCTOU race. Returns task_id or None."""
    p = params or {}
    params_text = json.dumps(p, sort_keys=True)
    task_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO tasks (id, type, status, params_json, created_at, updated_at) "
            "SELECT %s, %s, 'pending', %s, %s, %s "
            "WHERE NOT EXISTS ("
            "  SELECT 1 FROM tasks WHERE type = %s AND status IN ('pending', 'running') "
            "  AND params_json::text = %s"
            ")",
            (task_id, task_type, params_text, now, now, task_type, params_text),
        )
        if cur.rowcount == 0:
            return None  # duplicate
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


# Tasks that do heavy DB writes — only one at a time
DB_HEAVY_TASKS = {"library_sync", "library_pipeline", "wipe_library", "rebuild_library", "repair", "enrich_mbids"}


def claim_next_task(max_running: int = 5) -> dict | None:
    with get_db_ctx() as cur:
        # Gate at DB level: don't claim if already at max running
        cur.execute("SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'running'")
        running_count = cur.fetchone()["cnt"]
        if running_count >= max_running:
            return None

        # Check if a DB-heavy task is already running
        cur.execute(
            "SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'running' AND type = ANY(%s)",
            (list(DB_HEAVY_TASKS),),
        )
        db_heavy_running = cur.fetchone()["cnt"] > 0

        # If DB-heavy is running, only claim non-DB-heavy tasks
        if db_heavy_running:
            cur.execute(
                "SELECT * FROM tasks WHERE status = 'pending' AND type != ALL(%s) "
                "ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
                (list(DB_HEAVY_TASKS),),
            )
        else:
            cur.execute(
                "SELECT * FROM tasks WHERE status = 'pending' "
                "ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
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


