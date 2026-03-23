import json
from datetime import datetime, timezone
from musicdock.db.core import get_db_ctx

# ── Settings ──────────────────────────────────────────────────────

def get_setting(key: str, default: str | None = None) -> str | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
        row = cur.fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str):
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO settings (key, value) VALUES (%s, %s) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value",
            (key, value),
        )


# ── MusicBrainz cache ───────────────────────────────────────────

def get_mb_cache(key: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT value_json FROM mb_cache WHERE key = %s", (key,))
        row = cur.fetchone()
    if not row:
        return None
    val = row["value_json"]
    return val if isinstance(val, dict) else json.loads(val)


def set_mb_cache(key: str, value: dict):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO mb_cache (key, value_json, created_at) VALUES (%s, %s, %s) "
            "ON CONFLICT(key) DO UPDATE SET value_json = EXCLUDED.value_json, created_at = EXCLUDED.created_at",
            (key, json.dumps(value), now),
        )


# ── Generic cache ────────────────────────────────────────────────

def get_cache(key: str, max_age_seconds: int | None = None) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT value_json, updated_at FROM cache WHERE key = %s", (key,))
        row = cur.fetchone()
    if not row:
        return None
    if max_age_seconds is not None:
        updated = datetime.fromisoformat(row["updated_at"])
        age = (datetime.now(timezone.utc) - updated).total_seconds()
        if age > max_age_seconds:
            return None
    val = row["value_json"]
    return val if isinstance(val, (dict, list)) else json.loads(val)


def set_cache(key: str, value: dict):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO cache (key, value_json, updated_at) VALUES (%s, %s, %s) "
            "ON CONFLICT(key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = EXCLUDED.updated_at",
            (key, json.dumps(value), now),
        )


def delete_cache(key: str):
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM cache WHERE key = %s", (key,))


# ── Directory mtime tracking ────────────────────────────────────

def get_dir_mtime(path: str) -> tuple[float, dict | None] | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT mtime, data_json FROM dir_mtimes WHERE path = %s", (path,))
        row = cur.fetchone()
    if not row:
        return None
    data = row["data_json"]
    if isinstance(data, str):
        data = json.loads(data)
    return (row["mtime"], data)


def set_dir_mtime(path: str, mtime: float, data: dict | None = None):
    with get_db_ctx() as cur:
        data_json = json.dumps(data) if data is not None else None
        cur.execute(
            "INSERT INTO dir_mtimes (path, mtime, data_json) VALUES (%s, %s, %s) "
            "ON CONFLICT(path) DO UPDATE SET mtime = EXCLUDED.mtime, data_json = EXCLUDED.data_json",
            (path, mtime, data_json),
        )


def get_all_dir_mtimes(prefix: str = "") -> dict[str, tuple[float, dict | None]]:
    with get_db_ctx() as cur:
        if prefix:
            cur.execute("SELECT path, mtime, data_json FROM dir_mtimes WHERE path LIKE %s", (prefix + "%",))
        else:
            cur.execute("SELECT path, mtime, data_json FROM dir_mtimes")
        rows = cur.fetchall()
    result = {}
    for row in rows:
        data = row["data_json"]
        if isinstance(data, str):
            data = json.loads(data)
        result[row["path"]] = (row["mtime"], data)
    return result


def delete_dir_mtime(path: str):
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM dir_mtimes WHERE path = %s", (path,))


