from __future__ import annotations

from datetime import datetime, timezone

from crate.db.queries.auth_presence import get_users_presence as query_get_users_presence
from crate.db.queries.auth_user_lists import list_users as query_list_users, list_users_map_rows as query_list_users_map_rows
from crate.db.repositories.auth_shared import model_to_dict
from crate.db.repositories.auth_user_accounts import get_user_by_id
from crate.db.orm.user import User
from crate.db.tx import optional_scope

_USER_UPDATABLE_FIELDS = frozenset(
    {
        "email",
        "name",
        "username",
        "bio",
        "role",
        "password_hash",
        "google_id",
        "avatar",
        "subsonic_token",
    }
)

_USER_LOCATION_FIELDS = frozenset(
    {
        "city",
        "country",
        "country_code",
        "latitude",
        "longitude",
        "show_radius_km",
        "show_location_mode",
    }
)


def get_user_presence(user_id: int) -> dict:
    return get_users_presence([user_id]).get(
        user_id,
        {
            "online_now": False,
            "active_devices": 0,
            "active_sessions": 0,
            "listening_now": False,
            "current_track": None,
            "last_played_at": None,
            "last_seen_at": None,
        },
    )


def get_users_presence(user_ids: list[int]) -> dict[int, dict]:
    return query_get_users_presence(user_ids)


def update_user_last_login(user_id: int, *, session=None):
    def _impl(s) -> None:
        user = s.get(User, user_id)
        if user is not None:
            user.last_login = datetime.now(timezone.utc)

    with optional_scope(session) as s:
        _impl(s)


def list_users() -> list[dict]:
    return query_list_users()


def list_users_map_rows() -> list[dict]:
    return query_list_users_map_rows()


def update_user(user_id: int, *, session=None, **fields) -> dict | None:
    if not fields:
        return get_user_by_id(user_id, session=session)
    invalid = set(fields) - _USER_UPDATABLE_FIELDS
    if invalid:
        raise ValueError(f"Invalid fields for user update: {invalid}")

    def _impl(s) -> dict | None:
        user = s.get(User, user_id)
        if user is None:
            return None
        for key, value in fields.items():
            setattr(user, key, value)
        s.flush()
        return model_to_dict(user)

    with optional_scope(session) as s:
        return _impl(s)


def update_user_location(user_id: int, *, session=None, **fields) -> dict | None:
    if not fields:
        return get_user_by_id(user_id, session=session)

    invalid = set(fields) - _USER_LOCATION_FIELDS
    if invalid:
        invalid_csv = ", ".join(sorted(invalid))
        raise ValueError(f"Unsupported user location fields: {invalid_csv}")

    def _impl(s) -> dict | None:
        user = s.get(User, user_id)
        if user is None:
            return None

        for key, value in fields.items():
            setattr(user, key, value)
        s.flush()
        return model_to_dict(user)

    with optional_scope(session) as s:
        return _impl(s)


def delete_user(user_id: int, *, session=None):
    def _impl(s) -> None:
        user = s.get(User, user_id)
        if user is not None:
            s.delete(user)

    with optional_scope(session) as s:
        _impl(s)


__all__ = [
    "delete_user",
    "get_user_presence",
    "get_users_presence",
    "list_users",
    "list_users_map_rows",
    "update_user",
    "update_user_last_login",
    "update_user_location",
]
