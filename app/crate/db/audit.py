import json
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.serialize import serialize_row
from crate.db.tx import transaction_scope

# ── Audit log ────────────────────────────────────────────────────

def log_audit(action: str, target_type: str, target_name: str,
              details: dict | None = None, user_id: int | None = None,
              task_id: str | None = None):
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO audit_log (timestamp, action, target_type, target_name, details_json, user_id, task_id) "
                "VALUES (:ts, :action, :target_type, :target_name, :details_json, :user_id, :task_id)"
            ),
            {
                "ts": now, "action": action, "target_type": target_type,
                "target_name": target_name,
                "details_json": json.dumps(details, default=str) if details else "{}",
                "user_id": user_id, "task_id": task_id,
            },
        )


def get_audit_log(limit: int = 100, offset: int = 0,
                  action: str | None = None) -> tuple[list[dict], int]:
    where = "WHERE 1=1"
    params: dict = {}
    if action:
        where += " AND action = :action"
        params["action"] = action

    with transaction_scope() as session:
        row = session.execute(
            text(f"SELECT COUNT(*) AS cnt FROM audit_log {where}"), params
        ).mappings().first()
        total = row["cnt"]
        params["lim"] = limit
        params["off"] = offset
        rows = session.execute(
            text(f"SELECT * FROM audit_log {where} ORDER BY timestamp DESC LIMIT :lim OFFSET :off"),
            params,
        ).mappings().all()

    results = []
    for row in rows:
        d = serialize_row(row)
        det = d.pop("details_json", {})
        d["details"] = det if isinstance(det, dict) else json.loads(det or "{}")
        results.append(d)
    return results, total


# ── Library management ───────────────────────────────────────────

def wipe_library_tables():
    with transaction_scope() as session:
        session.execute(text("TRUNCATE library_tracks, library_albums, library_artists CASCADE"))


def get_db_table_stats() -> dict:
    tables = [
        "library_artists", "library_albums", "library_tracks",
        "tasks", "cache", "mb_cache", "settings", "audit_log",
        "scan_results", "dir_mtimes", "users", "sessions",
    ]
    stats = {}
    with transaction_scope() as session:
        for table in tables:
            try:
                row = session.execute(
                    text(
                        "SELECT pg_total_relation_size(:tbl) AS size, "
                        f"(SELECT COUNT(*) FROM {table} ) AS cnt"
                    ),
                    {"tbl": table},
                ).mappings().first()
                stats[table] = {"size": row["size"], "rows": row["cnt"]}
            except Exception:
                stats[table] = {"size": 0, "rows": 0}
    return stats
