import os
import json
from datetime import datetime, timezone
from musicdock.db.core import get_db_ctx

# ── Users ─────────────────────────────────────────────────────────

def _seed_admin(cur):
    cur.execute("SELECT COUNT(*) AS cnt FROM users")
    if cur.fetchone()["cnt"] == 0:
        from musicdock.auth import hash_password
        now = datetime.now(timezone.utc).isoformat()
        password = os.environ.get("DEFAULT_ADMIN_PASSWORD", "admin123")
        cur.execute(
            "INSERT INTO users (email, username, name, password_hash, role, created_at) VALUES (%s, %s, %s, %s, %s, %s)",
            ("yosoy@diego.ninja", "admin", "Diego", hash_password(password), "admin", now),
        )
    else:
        # Ensure admin has username set
        cur.execute("UPDATE users SET username = 'admin' WHERE email = 'yosoy@diego.ninja' AND (username IS NULL OR username = '')")


def create_user(email: str, name: str | None = None, password_hash: str | None = None,
                avatar: str | None = None, role: str = "user", google_id: str | None = None) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            """INSERT INTO users (email, name, password_hash, avatar, role, google_id, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *""",
            (email, name, password_hash, avatar, role, google_id, now),
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
        cur.execute("SELECT id, email, name, avatar, role, google_id, created_at, last_login FROM users ORDER BY id")
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


