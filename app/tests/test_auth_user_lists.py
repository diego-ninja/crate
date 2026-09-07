from contextlib import contextmanager
from datetime import datetime, timedelta, timezone


class _FakeResult:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def all(self):
        return self.rows


class _FakeSession:
    def __init__(self, rows):
        self.rows = rows

    def execute(self, _statement, _params=None):
        return _FakeResult(self.rows)


def _read_scope_for(rows):
    @contextmanager
    def read_scope():
        yield _FakeSession(rows)

    return read_scope


def test_list_users_exposes_derived_activity_fields(monkeypatch):
    from crate.db.queries import auth_user_lists

    now = datetime.now(timezone.utc)
    rows = [
        {
            "id": 1,
            "email": "inactive@example.com",
            "username": "inactive",
            "name": "Inactive",
            "avatar": None,
            "role": "user",
            "status": "active",
            "status_reason": None,
            "suspended_at": None,
            "deleted_at": None,
            "google_id": None,
            "bio": None,
            "has_password": True,
            "created_at": now - timedelta(days=60),
            "last_login": now - timedelta(days=31),
            "active_sessions": 0,
            "connected_accounts": [],
            "last_seen_at": None,
        }
    ]
    monkeypatch.setattr(auth_user_lists, "read_scope", _read_scope_for(rows))
    monkeypatch.setattr(
        auth_user_lists,
        "get_users_presence",
        lambda _user_ids: {
            1: {
                "last_seen_at": None,
                "last_played_at": None,
                "online_now": False,
            }
        },
    )

    result = auth_user_lists.list_users()

    assert result[0]["activity_status"] == "inactive"
    assert result[0]["last_activity_at"] == now - timedelta(days=31)


def test_map_rows_keeps_all_located_users_and_reuses_presence(monkeypatch):
    from crate.db.queries import auth_user_lists

    now = datetime.now(timezone.utc)
    rows = [
        {
            "id": 1,
            "name": "First",
            "email": "first@example.com",
            "avatar": None,
            "city": "Madrid",
            "country": "Spain",
            "country_code": "ES",
            "latitude": 40.4168,
            "longitude": -3.7038,
            "role": "user",
            "status": "active",
            "username": "first",
            "created_at": now - timedelta(days=60),
            "last_login": now - timedelta(days=2),
        },
        {
            "id": 2,
            "name": "Second",
            "email": "second@example.com",
            "avatar": None,
            "city": "Madrid",
            "country": "Spain",
            "country_code": "ES",
            "latitude": 40.4168,
            "longitude": -3.7038,
            "role": "admin",
            "status": "active",
            "username": "second",
            "created_at": now - timedelta(days=60),
            "last_login": now - timedelta(days=31),
        },
    ]
    monkeypatch.setattr(auth_user_lists, "read_scope", _read_scope_for(rows))
    monkeypatch.setattr(
        auth_user_lists,
        "get_users_presence",
        lambda _user_ids: {
            1: {
                "online_now": True,
                "listening_now": True,
                "active_devices": 1,
                "active_sessions": 1,
                "current_track": {"title": "Track", "artist": "Artist"},
                "last_played_at": now - timedelta(minutes=2),
                "last_seen_at": now - timedelta(minutes=1),
            },
            2: {
                "online_now": False,
                "listening_now": False,
                "active_devices": 0,
                "active_sessions": 0,
                "current_track": None,
                "last_played_at": None,
                "last_seen_at": now - timedelta(days=31),
            },
        },
    )

    result = auth_user_lists.list_users_map_rows()

    assert [user["id"] for user in result] == [1, 2]
    assert result[0]["online"] is True
    assert result[0]["now_playing"]["title"] == "Track"
    assert result[0]["activity_status"] == "active"
    assert result[1]["activity_status"] == "inactive"
