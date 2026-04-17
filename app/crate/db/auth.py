import json
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from crate.db.tx import transaction_scope

log = logging.getLogger(__name__)


def suggest_username(email: str, preferred: str | None = None, *, session=None) -> str:
    base = (preferred or email.split("@")[0]).strip().lower()
    base = re.sub(r"[^a-z0-9._-]+", "-", base).strip(".-_") or "user"
    if session is None:
        with transaction_scope() as s:
            return suggest_username(email, preferred, session=s)
    candidate = base
    suffix = 1
    while True:
        row = session.execute(
            text("SELECT 1 FROM users WHERE username = :username"),
            {"username": candidate},
        ).mappings().first()
        if not row:
            return candidate
        candidate = f"{base}-{suffix}"
        suffix += 1

# ── Users ─────────────────────────────────────────────────────────

def count_users() -> int:
    with transaction_scope() as session:
        row = session.execute(text("SELECT COUNT(*) AS cnt FROM users")).mappings().first()
        return row["cnt"]


def _seed_admin(session=None):
    """Seed the default admin user. Accepts an optional Session for
    atomicity when called from init_db() alongside other seeds."""
    if session is None:
        with transaction_scope() as s:
            return _seed_admin(s)
    # From here, uses the caller's session (shared transaction).
    row = session.execute(text("SELECT COUNT(*) AS cnt FROM users")).mappings().first()
    if row["cnt"] == 0:
        from crate.auth import hash_password
        now = datetime.now(timezone.utc).isoformat()
        password = os.environ.get("DEFAULT_ADMIN_PASSWORD", "")
        if not password:
            import secrets
            password = secrets.token_urlsafe(16)
            log.warning("No DEFAULT_ADMIN_PASSWORD set — generated: %s", password)
        session.execute(
            text("""INSERT INTO users (email, username, name, password_hash, role, created_at)
                    VALUES (:email, :username, :name, :password_hash, :role, :created_at)
                    ON CONFLICT (email) DO NOTHING"""),
            {"email": "admin@cratemusic.app", "username": "admin", "name": "Admin", "password_hash": hash_password(password), "role": "admin", "created_at": now},
        )
    else:
        session.execute(text("UPDATE users SET username = 'admin' WHERE email = 'admin@cratemusic.app' AND (username IS NULL OR username = '')"))


def create_user(email: str, name: str | None = None, password_hash: str | None = None,
                avatar: str | None = None, role: str = "user", google_id: str | None = None,
                username: str | None = None, *, session=None) -> dict:
    if session is None:
        with transaction_scope() as s:
            return create_user(email, name, password_hash, avatar, role, google_id, username, session=s)
    now = datetime.now(timezone.utc).isoformat()
    final_username = username or suggest_username(email, session=session)
    row = session.execute(
        text("""INSERT INTO users (email, username, name, password_hash, avatar, role, google_id, created_at)
           VALUES (:email, :username, :name, :password_hash, :avatar, :role, :google_id, :created_at)
           ON CONFLICT (email) DO NOTHING
           RETURNING *"""),
        {"email": email, "username": final_username, "name": name, "password_hash": password_hash,
         "avatar": avatar, "role": role, "google_id": google_id, "created_at": now},
    ).mappings().first()
    if not row:
        raise ValueError(f"Email already registered: {email}")
    return dict(row)


def get_user_by_email(email: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT * FROM users WHERE email = :email"), {"email": email}).mappings().first()
    return dict(row) if row else None


def get_user_by_google_id(google_id: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT * FROM users WHERE google_id = :google_id"), {"google_id": google_id}).mappings().first()
    return dict(row) if row else None


def get_user_by_external_identity(provider: str, external_user_id: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text("""
            SELECT u.*
            FROM user_external_identities uei
            JOIN users u ON u.id = uei.user_id
            WHERE uei.provider = :provider
              AND uei.external_user_id = :external_user_id
            LIMIT 1
            """),
            {"provider": provider, "external_user_id": external_user_id},
        ).mappings().first()
    return dict(row) if row else None


def get_user_by_id(user_id: int, *, session=None) -> dict | None:
    if session is None:
        with transaction_scope() as s:
            return get_user_by_id(user_id, session=s)
    row = session.execute(text("SELECT * FROM users WHERE id = :user_id"), {"user_id": user_id}).mappings().first()
    return dict(row) if row else None


def update_user_last_login(user_id: int, *, session=None):
    if session is None:
        with transaction_scope() as s:
            return update_user_last_login(user_id, session=s)
    now = datetime.now(timezone.utc).isoformat()
    session.execute(text("UPDATE users SET last_login = :now WHERE id = :user_id"), {"now": now, "user_id": user_id})


def list_users() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
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
            """)
        ).mappings().all()
    return [dict(r) for r in rows]


_USER_UPDATABLE_FIELDS = frozenset({
    "email", "name", "username", "bio", "role", "password_hash", "google_id", "avatar", "subsonic_token",
})


def update_user(user_id: int, *, session=None, **fields) -> dict | None:
    if not fields:
        return get_user_by_id(user_id, session=session)
    invalid = set(fields) - _USER_UPDATABLE_FIELDS
    if invalid:
        raise ValueError(f"Invalid fields for user update: {invalid}")
    if session is None:
        with transaction_scope() as s:
            return update_user(user_id, session=s, **fields)
    sets = ", ".join(f"{k} = :f_{k}" for k in fields)
    params = {f"f_{k}": v for k, v in fields.items()}
    params["user_id"] = user_id
    row = session.execute(text(f"UPDATE users SET {sets} WHERE id = :user_id RETURNING *"), params).mappings().first()
    return dict(row) if row else None


def delete_user(user_id: int, *, session=None):
    if session is None:
        with transaction_scope() as s:
            return delete_user(user_id, session=s)
    session.execute(text("DELETE FROM users WHERE id = :user_id"), {"user_id": user_id})


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
    session=None,
) -> dict:
    if session is None:
        with transaction_scope() as s:
            return create_session(session_id, user_id, expires_at,
                                  last_seen_ip=last_seen_ip, user_agent=user_agent,
                                  app_id=app_id, device_label=device_label, session=s)
    if not device_label and user_agent:
        device_label = _parse_device_label(user_agent)
    now = datetime.now(timezone.utc).isoformat()
    row = session.execute(
        text("""
        INSERT INTO sessions (
            id, user_id, expires_at, created_at, last_seen_at, last_seen_ip, user_agent, app_id, device_label
        )
        VALUES (:id, :user_id, :expires_at, :created_at, :last_seen_at, :last_seen_ip, :user_agent, :app_id, :device_label)
        RETURNING *
        """),
        {"id": session_id, "user_id": user_id, "expires_at": expires_at,
         "created_at": now, "last_seen_at": now, "last_seen_ip": last_seen_ip,
         "user_agent": user_agent, "app_id": app_id, "device_label": device_label},
    ).mappings().first()
    return dict(row)


def get_session(session_id: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT * FROM sessions WHERE id = :session_id"), {"session_id": session_id}).mappings().first()
    return dict(row) if row else None


def list_sessions(user_id: int, *, include_revoked: bool = False) -> list[dict]:
    with transaction_scope() as session:
        query_parts = [
            "SELECT * FROM sessions WHERE user_id = :user_id",
        ]
        params: dict = {"user_id": user_id}
        if not include_revoked:
            query_parts.append("AND revoked_at IS NULL")
        query_parts.append("ORDER BY COALESCE(last_seen_at, created_at) DESC")
        rows = session.execute(text("\n".join(query_parts)), params).mappings().all()
        return [dict(row) for row in rows]


def touch_session(
    session_id: str,
    *,
    last_seen_ip: str | None = None,
    user_agent: str | None = None,
    app_id: str | None = None,
    device_label: str | None = None,
) -> dict | None:
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        row = session.execute(
            text("""
            UPDATE sessions
            SET last_seen_at = :now,
                last_seen_ip = COALESCE(:last_seen_ip, last_seen_ip),
                user_agent = COALESCE(:user_agent, user_agent),
                app_id = COALESCE(:app_id, app_id),
                device_label = COALESCE(:device_label, device_label)
            WHERE id = :session_id
            RETURNING *
            """),
            {"now": now, "last_seen_ip": last_seen_ip, "user_agent": user_agent,
             "app_id": app_id, "device_label": device_label, "session_id": session_id},
        ).mappings().first()
    return dict(row) if row else None


def revoke_session(session_id: str, *, session=None) -> bool:
    if session is None:
        with transaction_scope() as s:
            return revoke_session(session_id, session=s)
    now = datetime.now(timezone.utc).isoformat()
    result = session.execute(
        text("UPDATE sessions SET revoked_at = :now WHERE id = :session_id AND revoked_at IS NULL"),
        {"now": now, "session_id": session_id},
    )
    return result.rowcount > 0


def revoke_other_sessions(user_id: int, current_session_id: str | None = None, *, session=None) -> int:
    if session is None:
        with transaction_scope() as s:
            return revoke_other_sessions(user_id, current_session_id, session=s)
    now = datetime.now(timezone.utc).isoformat()
    if current_session_id:
        result = session.execute(
            text("""
            UPDATE sessions
            SET revoked_at = :now
            WHERE user_id = :user_id
              AND id != :current_session_id
              AND revoked_at IS NULL
            """),
            {"now": now, "user_id": user_id, "current_session_id": current_session_id},
        )
    else:
        result = session.execute(
            text("UPDATE sessions SET revoked_at = :now WHERE user_id = :user_id AND revoked_at IS NULL"),
            {"now": now, "user_id": user_id},
        )
    return result.rowcount


def delete_session(session_id: str, *, session=None):
    if session is None:
        with transaction_scope() as s:
            return delete_session(session_id, session=s)
    session.execute(text("DELETE FROM sessions WHERE id = :session_id"), {"session_id": session_id})


def get_user_external_identity(user_id: int, provider: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT * FROM user_external_identities WHERE user_id = :user_id AND provider = :provider"),
            {"user_id": user_id, "provider": provider},
        ).mappings().first()
    return dict(row) if row else None


def list_user_external_identities(user_id: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT * FROM user_external_identities WHERE user_id = :user_id ORDER BY provider"),
            {"user_id": user_id},
        ).mappings().all()
        return [dict(row) for row in rows]


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
    session=None,
) -> dict:
    if session is None:
        with transaction_scope() as s:
            return upsert_user_external_identity(
                user_id, provider,
                external_user_id=external_user_id, external_username=external_username,
                status=status, last_error=last_error, last_task_id=last_task_id,
                metadata=metadata, last_synced_at=last_synced_at, session=s,
            )
    now = datetime.now(timezone.utc).isoformat()
    metadata_payload = json.dumps(metadata) if metadata is not None else None
    row = session.execute(
        text("""
        INSERT INTO user_external_identities (
            user_id, provider, external_user_id, external_username, status,
            last_error, last_task_id, metadata_json, last_synced_at, created_at, updated_at
        )
        VALUES (:user_id, :provider, :external_user_id, :external_username, :status,
                :last_error, :last_task_id, :metadata_json, :last_synced_at, :created_at, :updated_at)
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
        """),
        {
            "user_id": user_id,
            "provider": provider,
            "external_user_id": external_user_id,
            "external_username": external_username,
            "status": status or "unlinked",
            "last_error": last_error,
            "last_task_id": last_task_id,
            "metadata_json": metadata_payload,
            "last_synced_at": last_synced_at,
            "created_at": now,
            "updated_at": now,
        },
    ).mappings().first()
    return dict(row)


def unlink_user_external_identity(user_id: int, provider: str, *, session=None) -> None:
    if session is None:
        with transaction_scope() as s:
            return unlink_user_external_identity(user_id, provider, session=s)
    now = datetime.now(timezone.utc).isoformat()
    session.execute(
        text("""
        INSERT INTO user_external_identities (user_id, provider, status, created_at, updated_at)
        VALUES (:user_id, :provider, 'unlinked', :created_at, :updated_at)
        ON CONFLICT (user_id, provider) DO UPDATE SET
            external_user_id = NULL,
            external_username = NULL,
            status = 'unlinked',
            last_error = NULL,
            last_task_id = NULL,
            last_synced_at = NULL,
            updated_at = EXCLUDED.updated_at
        """),
        {"user_id": user_id, "provider": provider, "created_at": now, "updated_at": now},
    )


def create_auth_invite(
    created_by: int | None,
    *,
    email: str | None = None,
    expires_in_hours: int = 168,
    max_uses: int | None = 1,
    session=None,
) -> dict:
    if session is None:
        with transaction_scope() as s:
            return create_auth_invite(created_by, email=email,
                                      expires_in_hours=expires_in_hours,
                                      max_uses=max_uses, session=s)
    now = datetime.now(timezone.utc)
    token = secrets.token_urlsafe(24)
    expires_at = (now + timedelta(hours=expires_in_hours)).isoformat() if expires_in_hours > 0 else None
    row = session.execute(
        text("""
        INSERT INTO auth_invites (token, email, created_by, expires_at, max_uses, created_at)
        VALUES (:token, :email, :created_by, :expires_at, :max_uses, :created_at)
        RETURNING *
        """),
        {"token": token, "email": email, "created_by": created_by,
         "expires_at": expires_at, "max_uses": max_uses, "created_at": now.isoformat()},
    ).mappings().first()
    return dict(row)


def get_auth_invite(token: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT * FROM auth_invites WHERE token = :token"), {"token": token}).mappings().first()
    return dict(row) if row else None


def list_auth_invites(created_by: int | None = None) -> list[dict]:
    with transaction_scope() as session:
        if created_by is None:
            rows = session.execute(text("SELECT * FROM auth_invites ORDER BY created_at DESC")).mappings().all()
        else:
            rows = session.execute(
                text("SELECT * FROM auth_invites WHERE created_by = :created_by ORDER BY created_at DESC"),
                {"created_by": created_by},
            ).mappings().all()
        return [dict(row) for row in rows]


def consume_auth_invite(token: str, *, session=None) -> dict | None:
    if session is None:
        with transaction_scope() as s:
            return consume_auth_invite(token, session=s)
    now = datetime.now(timezone.utc).isoformat()
    row = session.execute(
        text("""
        UPDATE auth_invites
        SET use_count = use_count + 1,
            accepted_at = COALESCE(accepted_at, :now)
        WHERE token = :token
          AND (expires_at IS NULL OR expires_at > :now2)
          AND (max_uses IS NULL OR use_count < max_uses)
        RETURNING *
        """),
        {"now": now, "token": token, "now2": now},
    ).mappings().first()
    return dict(row) if row else None


def cleanup_expired_sessions(max_age_days: int = 7, *, session=None) -> int:
    """Delete sessions that expired or were revoked more than max_age_days ago."""
    if session is None:
        with transaction_scope() as s:
            return cleanup_expired_sessions(max_age_days, session=s)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()
    result = session.execute(
        text("""
        DELETE FROM sessions
        WHERE (expires_at < :cutoff)
           OR (revoked_at IS NOT NULL AND revoked_at < :cutoff2)
        """),
        {"cutoff": cutoff, "cutoff2": cutoff},
    )
    return result.rowcount


def cleanup_ended_jam_rooms(max_age_days: int = 30, *, session=None) -> int:
    """Delete jam rooms, members, events, and invites for rooms ended more than max_age_days ago."""
    if session is None:
        with transaction_scope() as s:
            return cleanup_ended_jam_rooms(max_age_days, session=s)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()
    rows = session.execute(
        text("SELECT id FROM jam_rooms WHERE status = 'ended' AND ended_at < :cutoff"),
        {"cutoff": cutoff},
    ).mappings().all()
    room_ids = [r["id"] for r in rows]
    if not room_ids:
        return 0
    session.execute(text("DELETE FROM jam_room_events WHERE room_id = ANY(:ids)"), {"ids": room_ids})
    session.execute(text("DELETE FROM jam_room_invites WHERE room_id = ANY(:ids)"), {"ids": room_ids})
    session.execute(text("DELETE FROM jam_room_members WHERE room_id = ANY(:ids)"), {"ids": room_ids})
    session.execute(text("DELETE FROM jam_rooms WHERE id = ANY(:ids)"), {"ids": room_ids})
    return len(room_ids)
