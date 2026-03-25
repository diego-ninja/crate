"""Health issues — persistent issue tracking for library health."""

import json
from datetime import datetime, timezone
from musicdock.db.core import get_db_ctx


def upsert_health_issue(check_type: str, severity: str, description: str,
                        details: dict | None = None, auto_fixable: bool = False) -> int:
    """Insert or update an open health issue. Returns issue ID.
    Uses check_type + md5(description) as dedup key for open issues."""
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        # Try insert, on conflict (same open issue) just update severity/details
        cur.execute("""
            INSERT INTO health_issues (check_type, severity, description, details_json, auto_fixable, status, created_at)
            VALUES (%s, %s, %s, %s, %s, 'open', %s)
            ON CONFLICT (check_type, md5(description)) WHERE status = 'open'
            DO UPDATE SET severity = EXCLUDED.severity, details_json = EXCLUDED.details_json,
                         auto_fixable = EXCLUDED.auto_fixable
            RETURNING id
        """, (check_type, severity, description, json.dumps(details or {}), auto_fixable, now))
        return cur.fetchone()["id"]


def get_open_issues(check_type: str | None = None, limit: int = 500) -> list[dict]:
    """Get all open health issues, optionally filtered by type."""
    with get_db_ctx() as cur:
        if check_type:
            cur.execute(
                "SELECT * FROM health_issues WHERE status = 'open' AND check_type = %s ORDER BY severity, created_at DESC LIMIT %s",
                (check_type, limit))
        else:
            cur.execute(
                "SELECT * FROM health_issues WHERE status = 'open' ORDER BY severity, created_at DESC LIMIT %s",
                (limit,))
        return [dict(r) for r in cur.fetchall()]


def get_issue_counts() -> dict:
    """Get count of open issues grouped by check_type."""
    with get_db_ctx() as cur:
        cur.execute("SELECT check_type, COUNT(*) AS cnt FROM health_issues WHERE status = 'open' GROUP BY check_type ORDER BY cnt DESC")
        return {r["check_type"]: r["cnt"] for r in cur.fetchall()}


def resolve_issue(issue_id: int):
    """Mark a single issue as fixed."""
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute("UPDATE health_issues SET status = 'fixed', resolved_at = %s WHERE id = %s", (now, issue_id))


def resolve_issues_by_type(check_type: str):
    """Mark all open issues of a given type as fixed (e.g. after a repair run)."""
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute("UPDATE health_issues SET status = 'fixed', resolved_at = %s WHERE check_type = %s AND status = 'open'", (now, check_type))


def dismiss_issue(issue_id: int):
    """Dismiss an issue (user decided it's not a problem)."""
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute("UPDATE health_issues SET status = 'dismissed', resolved_at = %s WHERE id = %s", (now, issue_id))


def resolve_stale_issues(current_descriptions: set[str], check_type: str):
    """Resolve open issues of a check_type that no longer appear in a fresh scan.
    This auto-cleans issues that were fixed externally."""
    with get_db_ctx() as cur:
        cur.execute("SELECT id, description FROM health_issues WHERE check_type = %s AND status = 'open'", (check_type,))
        for row in cur.fetchall():
            if row["description"] not in current_descriptions:
                resolve_issue(row["id"])


def cleanup_old_resolved(days: int = 30):
    """Delete resolved/dismissed issues older than N days."""
    with get_db_ctx() as cur:
        cur.execute("""
            DELETE FROM health_issues
            WHERE status IN ('fixed', 'dismissed')
            AND resolved_at < NOW() - INTERVAL '%s days'
        """, (days,))
