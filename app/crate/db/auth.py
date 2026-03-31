import json
import logging
import os
import re
from datetime import datetime, timezone

from crate.db.core import get_db_ctx

log = logging.getLogger(__name__)


def suggest_username(email: str, preferred: str | None = None) -> str:
    base = (preferred or email.split("@")[0]).strip().lower()
    base = re.sub(r"[^a-z0-9._-]+", "-", base).strip(".-_") or "user"
    with get_db_ctx() as cur:
        candidate = base
        suffix = 1
        while True:
            cur.execute(
                "SELECT 1 FROM users WHERE username = %s",
                (candidate,),
            )
            if not cur.fetchone():
                return candidate
            candidate = f"{base}-{suffix}"
            suffix += 1

# ── Users ─────────────────────────────────────────────────────────

def _seed_admin(cur):
    cur.execute("SELECT COUNT(*) AS cnt FROM users")
    if cur.fetchone()["cnt"] == 0:
        from crate.auth import hash_password
        now = datetime.now(timezone.utc).isoformat()
        password = os.environ.get("DEFAULT_ADMIN_PASSWORD", "")
        if not password:
            import secrets
            password = secrets.token_urlsafe(16)
            log.warning("No DEFAULT_ADMIN_PASSWORD set — generated: %s", password)
        cur.execute(
            "INSERT INTO users (email, username, name, password_hash, role, created_at) VALUES (%s, %s, %s, %s, %s, %s)",
            ("yosoy@diego.ninja", "admin", "Diego", hash_password(password), "admin", now),
        )
    else:
        # Ensure admin has username set
        cur.execute("UPDATE users SET username = 'admin' WHERE email = 'yosoy@diego.ninja' AND (username IS NULL OR username = '')")


def create_user(email: str, name: str | None = None, password_hash: str | None = None,
                avatar: str | None = None, role: str = "user", google_id: str | None = None,
                username: str | None = None) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    final_username = username or suggest_username(email)
    with get_db_ctx() as cur:
        cur.execute(
            """INSERT INTO users (email, username, name, password_hash, avatar, role, google_id, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
            (email, final_username, name, password_hash, avatar, role, google_id, now),
        )
        return dict(cur.fetchone())


def get_user_by_email(email: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM users WHERE email = %s", (email,))
        row = cur.fetchone()
    return dict(row) if row else None


def get_user_by_google_id(google_id: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM users WHERE google_id = %s", (google_id,))
        row = cur.fetchone()
    return dict(row) if row else None


def get_user_by_id(user_id: int) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
    return dict(row) if row else None


def update_user_last_login(user_id: int):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute("UPDATE users SET last_login = %s WHERE id = %s", (now, user_id))


def list_users() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT
                u.id,
                u.email,
                u.username,
                u.name,
                u.avatar,
                u.role,
                u.google_id,
                u.created_at,
                u.last_login,
                uei.external_username AS navidrome_username,
                uei.status AS navidrome_status,
                uei.last_error AS navidrome_last_error,
                uei.last_task_id AS navidrome_last_task_id,
                uei.last_synced_at AS navidrome_last_synced_at
            FROM users u
            LEFT JOIN user_external_identities uei
              ON uei.user_id = u.id
             AND uei.provider = 'navidrome'
            ORDER BY u.id
            """
        )
        rows = cur.fetchall()
    return [dict(r) for r in rows]


def update_user(user_id: int, **fields) -> dict | None:
    if not fields:
        return get_user_by_id(user_id)
    sets = ", ".join(f"{k} = %s" for k in fields)
    vals = list(fields.values()) + [user_id]
    with get_db_ctx() as cur:
        cur.execute(f"UPDATE users SET {sets} WHERE id = %s RETURNING *", vals)
        row = cur.fetchone()
    return dict(row) if row else None


def delete_user(user_id: int):
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM users WHERE id = %s", (user_id,))


# ── Sessions ─────────────────────────────────────────────────────

def create_session(session_id: str, user_id: int, expires_at: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (%s, %s, %s, %s) RETURNING *",
            (session_id, user_id, expires_at, now),
        )
        return dict(cur.fetchone())


def get_session(session_id: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM sessions WHERE id = %s", (session_id,))
        row = cur.fetchone()
    return dict(row) if row else None


def delete_session(session_id: str):
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM sessions WHERE id = %s", (session_id,))


def get_user_external_identity(user_id: int, provider: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM user_external_identities WHERE user_id = %s AND provider = %s",
            (user_id, provider),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def upsert_user_external_identity(
    user_id: int,
    provider: str,
    *,
    external_user_id: str | None = None,
    external_username: str | None = None,
    status: str | None = None,
    last_error: str | None = None,
    last_task_id: str | None = None,
    metadata: dict | None = None,
    last_synced_at: str | None = None,
) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    metadata_payload = json.dumps(metadata) if metadata is not None else None
    with get_db_ctx() as cur:
        cur.execute(
            """
            INSERT INTO user_external_identities (
                user_id, provider, external_user_id, external_username, status,
                last_error, last_task_id, metadata_json, last_synced_at, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id, provider) DO UPDATE SET
                external_user_id = COALESCE(EXCLUDED.external_user_id, user_external_identities.external_user_id),
                external_username = COALESCE(EXCLUDED.external_username, user_external_identities.external_username),
                status = COALESCE(EXCLUDED.status, user_external_identities.status),
                last_error = EXCLUDED.last_error,
                last_task_id = COALESCE(EXCLUDED.last_task_id, user_external_identities.last_task_id),
                metadata_json = COALESCE(EXCLUDED.metadata_json, user_external_identities.metadata_json),
                last_synced_at = COALESCE(EXCLUDED.last_synced_at, user_external_identities.last_synced_at),
                updated_at = EXCLUDED.updated_at
            RETURNING *
            """,
            (
                user_id,
                provider,
                external_user_id,
                external_username,
                status or "unlinked",
                last_error,
                last_task_id,
                metadata_payload,
                last_synced_at,
                now,
                now,
            ),
        )
        return dict(cur.fetchone())


def unlink_user_external_identity(user_id: int, provider: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            """
            INSERT INTO user_external_identities (user_id, provider, status, created_at, updated_at)
            VALUES (%s, %s, 'unlinked', %s, %s)
            ON CONFLICT (user_id, provider) DO UPDATE SET
                external_user_id = NULL,
                external_username = NULL,
                status = 'unlinked',
                last_error = NULL,
                last_task_id = NULL,
                last_synced_at = NULL,
                updated_at = EXCLUDED.updated_at
            """,
            (user_id, provider, now, now),
        )
