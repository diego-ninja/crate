import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

_DB_PATH: Path | None = None


def _get_db_path() -> Path:
    global _DB_PATH
    if _DB_PATH is None:
        data_dir = os.environ.get("DATA_DIR", "/data")
        _DB_PATH = Path(data_dir) / "librarian.db"
    return _DB_PATH


def set_db_path(path: str | Path):
    global _DB_PATH
    _DB_PATH = Path(path)


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_get_db_path()), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def get_db_ctx():
    conn = get_db()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    _get_db_path().parent.mkdir(parents=True, exist_ok=True)
    with get_db_ctx() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                progress TEXT DEFAULT '',
                params_json TEXT DEFAULT '{}',
                result_json TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS scan_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT REFERENCES tasks(id),
                issues_json TEXT NOT NULL,
                scanned_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS mb_cache (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cache (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS dir_mtimes (
                path TEXT PRIMARY KEY,
                mtime REAL NOT NULL,
                data_json TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
            CREATE INDEX IF NOT EXISTS idx_mb_cache_created ON mb_cache(created_at);
        """)


# ── Task CRUD ─────────────────────────────────────────────────────

def create_task(task_type: str, params: dict | None = None) -> str:
    task_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as conn:
        conn.execute(
            "INSERT INTO tasks (id, type, status, params_json, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?, ?)",
            (task_id, task_type, json.dumps(params or {}), now, now),
        )
    return task_id


def update_task(task_id: str, *, status: str | None = None, progress: str | None = None,
                result: dict | None = None, error: str | None = None):
    now = datetime.now(timezone.utc).isoformat()
    fields = ["updated_at = ?"]
    values: list = [now]

    if status is not None:
        fields.append("status = ?")
        values.append(status)
    if progress is not None:
        fields.append("progress = ?")
        values.append(progress)
    if result is not None:
        fields.append("result_json = ?")
        values.append(json.dumps(result))
    if error is not None:
        fields.append("error = ?")
        values.append(error)

    values.append(task_id)
    with get_db_ctx() as conn:
        conn.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id = ?", values)


def get_task(task_id: str) -> dict | None:
    with get_db_ctx() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return _row_to_task(row) if row else None


def list_tasks(status: str | None = None, task_type: str | None = None, limit: int = 50) -> list[dict]:
    query = "SELECT * FROM tasks WHERE 1=1"
    params: list = []
    if status:
        query += " AND status = ?"
        params.append(status)
    if task_type:
        query += " AND type = ?"
        params.append(task_type)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    with get_db_ctx() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_row_to_task(r) for r in rows]


def claim_next_task() -> dict | None:
    with get_db_ctx() as conn:
        row = conn.execute(
            "SELECT * FROM tasks WHERE status = 'pending' ORDER BY created_at LIMIT 1"
        ).fetchone()
        if not row:
            return None
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'",
            (now, row["id"]),
        )
    return _row_to_task(row) if row else None


def _row_to_task(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["params"] = json.loads(d.pop("params_json", "{}") or "{}")
    result_raw = d.pop("result_json", None)
    d["result"] = json.loads(result_raw) if result_raw else None
    return d


# ── Scan results ──────────────────────────────────────────────────

def save_scan_result(task_id: str, issues: list[dict]):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as conn:
        conn.execute(
            "INSERT INTO scan_results (task_id, issues_json, scanned_at) VALUES (?, ?, ?)",
            (task_id, json.dumps(issues), now),
        )


def get_latest_scan() -> dict | None:
    with get_db_ctx() as conn:
        row = conn.execute(
            "SELECT * FROM scan_results ORDER BY scanned_at DESC LIMIT 1"
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    d["issues"] = json.loads(d.pop("issues_json"))
    return d


# ── Settings ──────────────────────────────────────────────────────

def get_setting(key: str, default: str | None = None) -> str | None:
    with get_db_ctx() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str):
    with get_db_ctx() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
            (key, value, value),
        )


# ── MusicBrainz cache ───────────────────────────────────────────

def get_mb_cache(key: str) -> dict | None:
    with get_db_ctx() as conn:
        row = conn.execute("SELECT value_json FROM mb_cache WHERE key = ?", (key,)).fetchone()
    if not row:
        return None
    return json.loads(row["value_json"])


def set_mb_cache(key: str, value: dict):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as conn:
        conn.execute(
            "INSERT INTO mb_cache (key, value_json, created_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value_json = ?, created_at = ?",
            (key, json.dumps(value), now, json.dumps(value), now),
        )


# ── Generic cache ────────────────────────────────────────────────

def get_cache(key: str, max_age_seconds: int | None = None) -> dict | None:
    with get_db_ctx() as conn:
        row = conn.execute("SELECT value_json, updated_at FROM cache WHERE key = ?", (key,)).fetchone()
    if not row:
        return None
    if max_age_seconds is not None:
        updated = datetime.fromisoformat(row["updated_at"])
        age = (datetime.now(timezone.utc) - updated).total_seconds()
        if age > max_age_seconds:
            return None
    return json.loads(row["value_json"])


def set_cache(key: str, value: dict):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as conn:
        conn.execute(
            "INSERT INTO cache (key, value_json, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value_json = ?, updated_at = ?",
            (key, json.dumps(value), now, json.dumps(value), now),
        )


# ── Directory mtime tracking ────────────────────────────────────

def get_dir_mtime(path: str) -> tuple[float, dict | None] | None:
    with get_db_ctx() as conn:
        row = conn.execute("SELECT mtime, data_json FROM dir_mtimes WHERE path = ?", (path,)).fetchone()
    if not row:
        return None
    data = json.loads(row["data_json"]) if row["data_json"] else None
    return (row["mtime"], data)


def set_dir_mtime(path: str, mtime: float, data: dict | None = None):
    with get_db_ctx() as conn:
        data_json = json.dumps(data) if data is not None else None
        conn.execute(
            "INSERT INTO dir_mtimes (path, mtime, data_json) VALUES (?, ?, ?) "
            "ON CONFLICT(path) DO UPDATE SET mtime = ?, data_json = ?",
            (path, mtime, data_json, mtime, data_json),
        )


def get_all_dir_mtimes(prefix: str = "") -> dict[str, tuple[float, dict | None]]:
    with get_db_ctx() as conn:
        if prefix:
            rows = conn.execute("SELECT path, mtime, data_json FROM dir_mtimes WHERE path LIKE ?", (prefix + "%",)).fetchall()
        else:
            rows = conn.execute("SELECT path, mtime, data_json FROM dir_mtimes").fetchall()
    result = {}
    for row in rows:
        data = json.loads(row["data_json"]) if row["data_json"] else None
        result[row["path"]] = (row["mtime"], data)
    return result


def delete_dir_mtime(path: str):
    with get_db_ctx() as conn:
        conn.execute("DELETE FROM dir_mtimes WHERE path = ?", (path,))
