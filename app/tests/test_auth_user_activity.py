from datetime import datetime, timedelta, timezone


def test_recent_activity_is_active_and_uses_latest_signal():
    from crate.db.queries.auth_user_activity import derive_user_activity

    now = datetime(2026, 8, 21, 12, tzinfo=timezone.utc)
    result = derive_user_activity(
        last_login=now - timedelta(days=20),
        last_seen_at=now - timedelta(days=2),
        last_played_at=now - timedelta(days=5),
        now=now,
        inactive_after_days=30,
    )

    assert result == {
        "activity_status": "active",
        "last_activity_at": now - timedelta(days=2),
    }


def test_activity_older_than_threshold_is_inactive():
    from crate.db.queries.auth_user_activity import derive_user_activity

    now = datetime(2026, 8, 21, 12, tzinfo=timezone.utc)
    result = derive_user_activity(
        last_login=now - timedelta(days=31),
        last_seen_at=None,
        last_played_at=None,
        now=now,
        inactive_after_days=30,
    )

    assert result["activity_status"] == "inactive"
    assert result["last_activity_at"] == now - timedelta(days=31)


def test_missing_activity_is_never_active():
    from crate.db.queries.auth_user_activity import derive_user_activity

    result = derive_user_activity(
        last_login=None,
        last_seen_at=None,
        last_played_at=None,
        now=datetime(2026, 8, 21, 12, tzinfo=timezone.utc),
    )

    assert result == {"activity_status": "never_active", "last_activity_at": None}


def test_invalid_activity_values_are_ignored():
    from crate.db.queries.auth_user_activity import derive_user_activity

    result = derive_user_activity(
        last_login="not-a-date",
        last_seen_at="2026-08-20T12:00:00+00:00",
        last_played_at="also-not-a-date",
        now=datetime(2026, 8, 21, 12, tzinfo=timezone.utc),
        inactive_after_days=30,
    )

    assert result["activity_status"] == "active"
    assert result["last_activity_at"] == datetime(2026, 8, 20, 12, tzinfo=timezone.utc)


def test_naive_activity_values_are_treated_as_utc():
    from crate.db.queries.auth_user_activity import derive_user_activity

    result = derive_user_activity(
        last_login=datetime(2026, 8, 20, 12),
        last_seen_at=None,
        last_played_at=None,
        now=datetime(2026, 8, 21, 12, tzinfo=timezone.utc),
    )

    assert result["activity_status"] == "active"
    assert result["last_activity_at"] == datetime(2026, 8, 20, 12, tzinfo=timezone.utc)


def test_environment_threshold_is_used_when_no_explicit_threshold(monkeypatch):
    from crate.db.queries.auth_user_activity import derive_user_activity

    monkeypatch.setenv("CRATE_USER_INACTIVE_AFTER_DAYS", "7")
    now = datetime(2026, 8, 21, 12, tzinfo=timezone.utc)

    result = derive_user_activity(
        last_login=now - timedelta(days=8),
        last_seen_at=None,
        last_played_at=None,
        now=now,
    )

    assert result["activity_status"] == "inactive"
