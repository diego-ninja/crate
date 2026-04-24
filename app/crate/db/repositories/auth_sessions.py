from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, text

from crate.db.orm.user import Session as AuthSession
from crate.db.repositories.auth_shared import coerce_datetime, model_to_dict, parse_device_label
from crate.db.tx import optional_scope, read_scope, transaction_scope


def create_session(
    session_id: str,
    user_id: int,
    expires_at: str | datetime,
    *,
    last_seen_ip: str | None = None,
    user_agent: str | None = None,
    app_id: str | None = None,
    device_label: str | None = None,
    session=None,
) -> dict:
    def _impl(s) -> dict:
        label = device_label or (parse_device_label(user_agent) if user_agent else None)
        now = datetime.now(timezone.utc)
        auth_session = AuthSession(
            id=session_id,
            user_id=user_id,
            expires_at=coerce_datetime(expires_at),
            created_at=now,
            last_seen_at=now,
            last_seen_ip=last_seen_ip,
            user_agent=user_agent,
            app_id=app_id,
            device_label=label,
        )
        s.add(auth_session)
        s.flush()
        return model_to_dict(auth_session)

    with optional_scope(session) as s:
        return _impl(s)


def get_session(session_id: str) -> dict | None:
    with read_scope() as session:
        auth_session = session.get(AuthSession, session_id)
        return model_to_dict(auth_session) if auth_session is not None else None


def list_sessions(user_id: int, *, include_revoked: bool = False) -> list[dict]:
    with read_scope() as session:
        stmt = select(AuthSession).where(AuthSession.user_id == user_id)
        if not include_revoked:
            stmt = stmt.where(AuthSession.revoked_at.is_(None))
        rows = session.execute(stmt.order_by(func.coalesce(AuthSession.last_seen_at, AuthSession.created_at).desc())).scalars().all()
        return [model_to_dict(row) for row in rows]


def touch_session(
    session_id: str,
    *,
    last_seen_ip: str | None = None,
    user_agent: str | None = None,
    app_id: str | None = None,
    device_label: str | None = None,
) -> dict | None:
    with transaction_scope() as session:
        auth_session = session.get(AuthSession, session_id)
        if auth_session is None:
            return None
        auth_session.last_seen_at = datetime.now(timezone.utc)
        if last_seen_ip is not None:
            auth_session.last_seen_ip = last_seen_ip
        if user_agent is not None:
            auth_session.user_agent = user_agent
        if app_id is not None:
            auth_session.app_id = app_id
        if device_label is not None:
            auth_session.device_label = device_label
        session.flush()
        return model_to_dict(auth_session)


def revoke_session(session_id: str, *, session=None) -> bool:
    def _impl(s) -> bool:
        auth_session = s.get(AuthSession, session_id)
        if auth_session is None or auth_session.revoked_at is not None:
            return False
        auth_session.revoked_at = datetime.now(timezone.utc)
        return True

    with optional_scope(session) as s:
        return _impl(s)


def revoke_other_sessions(user_id: int, current_session_id: str | None = None, *, session=None) -> int:
    def _impl(s) -> int:
        stmt = select(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        if current_session_id:
            stmt = stmt.where(AuthSession.id != current_session_id)
        rows = s.execute(stmt).scalars().all()
        revoked_at = datetime.now(timezone.utc)
        for row in rows:
            row.revoked_at = revoked_at
        return len(rows)

    with optional_scope(session) as s:
        return _impl(s)


def delete_session(session_id: str, *, session=None):
    def _impl(s) -> None:
        auth_session = s.get(AuthSession, session_id)
        if auth_session is not None:
            s.delete(auth_session)

    with optional_scope(session) as s:
        _impl(s)


def cleanup_expired_sessions(max_age_days: int = 7, *, session=None) -> int:
    if session is None:
        with transaction_scope() as s:
            return cleanup_expired_sessions(max_age_days, session=s)
    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
    rows = session.execute(
        select(AuthSession).where(
            (AuthSession.expires_at < cutoff)
            | ((AuthSession.revoked_at.is_not(None)) & (AuthSession.revoked_at < cutoff))
        )
    ).scalars().all()
    for row in rows:
        session.delete(row)
    return len(rows)


def cleanup_ended_jam_rooms(max_age_days: int = 30, *, session=None) -> int:
    if session is None:
        with transaction_scope() as s:
            return cleanup_ended_jam_rooms(max_age_days, session=s)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()
    rows = session.execute(
        text("SELECT id FROM jam_rooms WHERE status = 'ended' AND ended_at < :cutoff"),
        {"cutoff": cutoff},
    ).mappings().all()
    room_ids = [row["id"] for row in rows]
    if not room_ids:
        return 0
    session.execute(text("DELETE FROM jam_room_events WHERE room_id = ANY(:ids)"), {"ids": room_ids})
    session.execute(text("DELETE FROM jam_room_invites WHERE room_id = ANY(:ids)"), {"ids": room_ids})
    session.execute(text("DELETE FROM jam_room_members WHERE room_id = ANY(:ids)"), {"ids": room_ids})
    session.execute(text("DELETE FROM jam_rooms WHERE id = ANY(:ids)"), {"ids": room_ids})
    return len(room_ids)


__all__ = [
    "cleanup_ended_jam_rooms",
    "cleanup_expired_sessions",
    "create_session",
    "delete_session",
    "get_session",
    "list_sessions",
    "revoke_other_sessions",
    "revoke_session",
    "touch_session",
]
