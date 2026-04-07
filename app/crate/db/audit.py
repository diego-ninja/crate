import json
from datetime import datetime, timezone
from crate.db.core import get_db_ctx

# ── Audit log ────────────────────────────────────────────────────

def log_audit(action: str, target_type: str, target_name: str,
              details: dict | None = None, user_id: int | None = None,
              task_id: str | None = None):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO audit_log (timestamp, action, target_type, target_name, details_json, user_id, task_id) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (now, action, target_type, target_name,
             json.dumps(details, default=str) if details else "{}", user_id, task_id),
        )


def get_audit_log(limit: int = 100, offset: int = 0,
                  action: str | None = None) -> tuple[list[dict], int]:
    where = "WHERE 1=1"
    params: list = []
    if action:
        where += " AND action = %s"
        params.append(action)

    with get_db_ctx() as cur:
        cur.execute(f"SELECT COUNT(*) AS cnt FROM audit_log {where}", params)
        total = cur.fetchone()["cnt"]
        cur.execute(
            f"SELECT * FROM audit_log {where} ORDER BY timestamp DESC LIMIT %s OFFSET %s",
            params + [limit, offset],
        )
        rows = cur.fetchall()

    results = []
    for row in rows:
        d = dict(row)
        det = d.pop("details_json", {})
        d["details"] = det if isinstance(det, dict) else json.loads(det or "{}")
        results.append(d)
    return results, total


# ── Library management ───────────────────────────────────────────

def wipe_library_tables():
    with get_db_ctx() as cur:
        cur.execute("TRUNCATE library_tracks, library_albums, library_artists CASCADE")


def get_db_table_stats() -> dict:
    tables = [
        "library_artists", "library_albums", "library_tracks",
        "tasks", "cache", "mb_cache", "settings", "audit_log",
        "scan_results", "dir_mtimes", "users", "sessions",
    ]
    stats = {}
    with get_db_ctx() as cur:
        for table in tables:
            try:
                cur.execute(
                    "SELECT pg_total_relation_size(%s) AS size, "
                    "(SELECT COUNT(*) FROM {} ) AS cnt".format(table),
                    (table,),
                )
                row = cur.fetchone()
                stats[table] = {"size": row["size"], "rows": row["cnt"]}
            except Exception:
                stats[table] = {"size": 0, "rows": 0}
    return stats
