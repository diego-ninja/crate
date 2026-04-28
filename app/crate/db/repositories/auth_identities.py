from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select

from crate.db.orm.user import UserExternalIdentity
from crate.db.repositories.auth_shared import coerce_datetime, model_to_dict
from crate.db.tx import optional_scope, read_scope


def get_user_external_identity(user_id: int, provider: str) -> dict | None:
    with read_scope() as session:
        identity = session.execute(
            select(UserExternalIdentity)
            .where(UserExternalIdentity.user_id == user_id, UserExternalIdentity.provider == provider)
            .limit(1)
        ).scalar_one_or_none()
        return model_to_dict(identity) if identity is not None else None


def list_user_external_identities(user_id: int) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            select(UserExternalIdentity)
            .where(UserExternalIdentity.user_id == user_id)
            .order_by(UserExternalIdentity.provider)
        ).scalars().all()
        return [model_to_dict(row) for row in rows]


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
    last_synced_at: str | datetime | None = None,
    session=None,
) -> dict:
    def _impl(s) -> dict:
        identity = s.execute(
            select(UserExternalIdentity)
            .where(UserExternalIdentity.user_id == user_id, UserExternalIdentity.provider == provider)
            .limit(1)
        ).scalar_one_or_none()
        now = datetime.now(timezone.utc)
        if identity is None:
            identity = UserExternalIdentity(
                user_id=user_id,
                provider=provider,
                external_user_id=external_user_id,
                external_username=external_username,
                status=status or "unlinked",
                last_error=last_error,
                last_task_id=last_task_id,
                metadata_json=metadata if metadata is not None else {},
                last_synced_at=coerce_datetime(last_synced_at),
                created_at=now,
                updated_at=now,
            )
            s.add(identity)
        else:
            if external_user_id is not None:
                identity.external_user_id = external_user_id
            if external_username is not None:
                identity.external_username = external_username
            if status is not None:
                identity.status = status
            identity.last_error = last_error
            if last_task_id is not None:
                identity.last_task_id = last_task_id
            if metadata is not None:
                identity.metadata_json = metadata
            if last_synced_at is not None:
                identity.last_synced_at = coerce_datetime(last_synced_at)
            identity.updated_at = now
        s.flush()
        return model_to_dict(identity)

    with optional_scope(session) as s:
        return _impl(s)


def unlink_user_external_identity(user_id: int, provider: str, *, session=None) -> None:
    def _impl(s) -> None:
        identity = s.execute(
            select(UserExternalIdentity)
            .where(UserExternalIdentity.user_id == user_id, UserExternalIdentity.provider == provider)
            .limit(1)
        ).scalar_one_or_none()
        now = datetime.now(timezone.utc)
        if identity is None:
            identity = UserExternalIdentity(
                user_id=user_id,
                provider=provider,
                status="unlinked",
                metadata_json={},
                created_at=now,
                updated_at=now,
            )
            s.add(identity)
        else:
            identity.external_user_id = None
            identity.external_username = None
            identity.status = "unlinked"
            identity.last_error = None
            identity.last_task_id = None
            identity.last_synced_at = None
            identity.updated_at = now
        s.flush()

    with optional_scope(session) as s:
        _impl(s)


__all__ = [
    "get_user_external_identity",
    "list_user_external_identities",
    "unlink_user_external_identity",
    "upsert_user_external_identity",
]
