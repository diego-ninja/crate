import json
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone

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

def count_users() -> int:
    with get_db_ctx() as cur:
        cur.execute("SELECT COUNT(*) AS cnt FROM users")
        return cur.fetchone()["cnt"]


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
            ("admin@cratemusic.app", "admin", "Admin", hash_password(password), "admin", now),
        )
    else:
        # Ensure admin has username set
        cur.execute("UPDATE users SET username = 'admin' WHERE email = 'admin@cratemusic.app' AND (username IS NULL OR username = '')")


def create_user(email: str, name: str | None = None, password_hash: str | None = None,
                avatar: str | None = None, role: str = "user", google_id: str | None = None,
                username: str | None = None) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    final_username = username or suggest_username(email)
    with get_db_ctx() as cur:
        cur.execute(
            """INSERT INTO users (email, username, name, password_hash, avatar, role, google_id, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (email) DO NOTHING
               RETURNING *""",
            (email, final_username, name, password_hash, avatar, role, google_id, now),
        )
        row = cur.fetchone()
        if not row:
            raise ValueError(f"Email already registered: {email}")
        return dict(row)


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


def get_user_by_external_identity(provider: str, external_user_id: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT u.*
            FROM user_external_identities uei
            JOIN users u ON u.id = uei.user_id
            WHERE uei.provider = %s
              AND uei.external_user_id = %s
            LIMIT 1
            """,
            (provider, external_user_id),
        )
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
                u.bio,
                u.created_at,
                u.last_login,
                COALESCE((
                    SELECT COUNT(*)
                    FROM sessions s
                    WHERE s.user_id = u.id
                      AND s.revoked_at IS NULL
                      AND COALESCE(s.last_seen_at, s.created_at) >= NOW() - INTERVAL '10 minutes'
                ), 0)::INTEGER AS active_sessions,
                COALESCE((
                    SELECT json_agg(
                        json_build_object(
                            'provider', provider,
                            'status', status,
                            'external_username', external_username
                        )
                        ORDER BY provider
                    )
                    FROM user_external_identities
                    WHERE user_id = u.id
                ), '[]'::json) AS connected_accounts,
                COALESCE((
                    SELECT MAX(COALESCE(last_seen_at, created_at))
                    FROM sessions s
                    WHERE s.user_id = u.id
                      AND s.revoked_at IS NULL
                ), u.last_login) AS last_seen_at
            FROM users u
            ORDER BY u.id
            """
        )
        rows = cur.fetchall()
    return [dict(r) for r in rows]


_USER_UPDATABLE_FIELDS = frozenset({
    "email", "name", "username", "bio", "role", "password_hash", "google_id", "avatar", "subsonic_token",
})


def update_user(user_id: int, **fields) -> dict | None:
    if not fields:
        return get_user_by_id(user_id)
    invalid = set(fields) - _USER_UPDATABLE_FIELDS
    if invalid:
        raise ValueError(f"Invalid fields for user update: {invalid}")
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

def _parse_device_label(user_agent: str | None) -> str | None:
    """Parse user-agent into a human-readable device label using device-detector."""
    if not user_agent:
        return None
    try:
        from device_detector import DeviceDetector
        device = DeviceDetector(user_agent).parse()
        parts = []
        client = device.client_name()
        if client:
            parts.append(client)
        os_name = device.os_name()
        if os_name:
            parts.append(os_name)
        device_name = device.device_brand_name()
        model = device.device_model()
        if device_name and device_name != "Unknown":
            label = device_name
            if model and model != "Unknown":
                label += f" {model}"
            parts.append(label)
        return " · ".join(parts) if parts else None
    except Exception:
        return None


def create_session(
    session_id: str,
    user_id: int,
    expires_at: str,
    *,
    last_seen_ip: str | None = None,
    user_agent: str | None = None,
    app_id: str | None = None,
    device_label: str | None = None,
) -> dict:
    # Auto-detect device label from user-agent if not provided
    if not device_label and user_agent:
        device_label = _parse_device_label(user_agent)
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            """
            INSERT INTO sessions (
                id, user_id, expires_at, created_at, last_seen_at, last_seen_ip, user_agent, app_id, device_label
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (session_id, user_id, expires_at, now, now, last_seen_ip, user_agent, app_id, device_label),
        )
        return dict(cur.fetchone())


def get_session(session_id: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM sessions WHERE id = %s", (session_id,))
        row = cur.fetchone()
    return dict(row) if row else None


def list_sessions(user_id: int, *, include_revoked: bool = False) -> list[dict]:
    with get_db_ctx() as cur:
        query = [
            "SELECT * FROM sessions WHERE user_id = %s",
        ]
        params: list[object] = [user_id]
        if not include_revoked:
            query.append("AND revoked_at IS NULL")
        query.append("ORDER BY COALESCE(last_seen_at, created_at) DESC")
        cur.execute("\n".join(query), params)
        return [dict(row) for row in cur.fetchall()]


def touch_session(
    session_id: str,
    *,
    last_seen_ip: str | None = None,
    user_agent: str | None = None,
    app_id: str | None = None,
    device_label: str | None = None,
) -> dict | None:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            """
            UPDATE sessions
            SET last_seen_at = %s,
                last_seen_ip = COALESCE(%s, last_seen_ip),
                user_agent = COALESCE(%s, user_agent),
                app_id = COALESCE(%s, app_id),
                device_label = COALESCE(%s, device_label)
            WHERE id = %s
            RETURNING *
            """,
            (now, last_seen_ip, user_agent, app_id, device_label, session_id),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def revoke_session(session_id: str) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE sessions SET revoked_at = %s WHERE id = %s AND revoked_at IS NULL",
            (now, session_id),
        )
        return cur.rowcount > 0


def revoke_other_sessions(user_id: int, current_session_id: str | None = None) -> int:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        if current_session_id:
            cur.execute(
                """
                UPDATE sessions
                SET revoked_at = %s
                WHERE user_id = %s
                  AND id != %s
                  AND revoked_at IS NULL
                """,
                (now, user_id, current_session_id),
            )
        else:
            cur.execute(
                "UPDATE sessions SET revoked_at = %s WHERE user_id = %s AND revoked_at IS NULL",
                (now, user_id),
            )
        return cur.rowcount


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


def list_user_external_identities(user_id: int) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM user_external_identities WHERE user_id = %s ORDER BY provider",
            (user_id,),
        )
        return [dict(row) for row in cur.fetchall()]


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


def create_auth_invite(
    created_by: int | None,
    *,
    email: str | None = None,
    expires_in_hours: int = 168,
    max_uses: int | None = 1,
) -> dict:
    now = datetime.now(timezone.utc)
    token = secrets.token_urlsafe(24)
    expires_at = (now + timedelta(hours=expires_in_hours)).isoformat() if expires_in_hours > 0 else None
    with get_db_ctx() as cur:
        cur.execute(
            """
            INSERT INTO auth_invites (token, email, created_by, expires_at, max_uses, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (token, email, created_by, expires_at, max_uses, now.isoformat()),
        )
        return dict(cur.fetchone())


def get_auth_invite(token: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM auth_invites WHERE token = %s", (token,))
        row = cur.fetchone()
    return dict(row) if row else None


def list_auth_invites(created_by: int | None = None) -> list[dict]:
    with get_db_ctx() as cur:
        if created_by is None:
            cur.execute("SELECT * FROM auth_invites ORDER BY created_at DESC")
        else:
            cur.execute("SELECT * FROM auth_invites WHERE created_by = %s ORDER BY created_at DESC", (created_by,))
        return [dict(row) for row in cur.fetchall()]


def consume_auth_invite(token: str) -> dict | None:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            """
            UPDATE auth_invites
            SET use_count = use_count + 1,
                accepted_at = COALESCE(accepted_at, %s)
            WHERE token = %s
              AND (expires_at IS NULL OR expires_at > %s)
              AND (max_uses IS NULL OR use_count < max_uses)
            RETURNING *
            """,
            (now, token, now),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def cleanup_expired_sessions(max_age_days: int = 7) -> int:
    """Delete sessions that expired or were revoked more than max_age_days ago."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            """
            DELETE FROM sessions
            WHERE (expires_at < %s)
               OR (revoked_at IS NOT NULL AND revoked_at < %s)
            """,
            (cutoff, cutoff),
        )
        return cur.rowcount


def cleanup_ended_jam_rooms(max_age_days: int = 30) -> int:
    """Delete jam rooms, members, events, and invites for rooms ended more than max_age_days ago."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()
    with get_db_ctx() as cur:
        cur.execute("SELECT id FROM jam_rooms WHERE status = 'ended' AND ended_at < %s", (cutoff,))
        room_ids = [r["id"] for r in cur.fetchall()]
        if not room_ids:
            return 0
        placeholders = ",".join(["%s"] * len(room_ids))
        cur.execute(f"DELETE FROM jam_room_events WHERE room_id IN ({placeholders})", room_ids)
        cur.execute(f"DELETE FROM jam_room_invites WHERE room_id IN ({placeholders})", room_ids)
        cur.execute(f"DELETE FROM jam_room_members WHERE room_id IN ({placeholders})", room_ids)
        cur.execute(f"DELETE FROM jam_rooms WHERE id IN ({placeholders})", room_ids)
        return len(room_ids)
