from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from crate.db.repositories.auth_shared import coerce_datetime

DEFAULT_INACTIVE_AFTER_DAYS = 30
INACTIVE_AFTER_DAYS_ENV = "CRATE_USER_INACTIVE_AFTER_DAYS"


def _configured_inactive_after_days() -> int:
    raw_value = os.environ.get(INACTIVE_AFTER_DAYS_ENV)
    try:
        value = int(raw_value) if raw_value is not None else DEFAULT_INACTIVE_AFTER_DAYS
    except (TypeError, ValueError):
        value = DEFAULT_INACTIVE_AFTER_DAYS
    return max(1, min(value, 3650))


def _safe_coerce_datetime(value: str | datetime | None) -> datetime | None:
    try:
        parsed = coerce_datetime(value)
        if parsed is not None and parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except (TypeError, ValueError, AttributeError):
        return None


def derive_user_activity(
    *,
    last_login: str | datetime | None,
    last_seen_at: str | datetime | None,
    last_played_at: str | datetime | None,
    now: datetime | None = None,
    inactive_after_days: int | None = None,
) -> dict[str, str | datetime | None]:
    activity_timestamps = [
        timestamp
        for timestamp in (
            _safe_coerce_datetime(last_login),
            _safe_coerce_datetime(last_seen_at),
            _safe_coerce_datetime(last_played_at),
        )
        if timestamp is not None
    ]
    if not activity_timestamps:
        return {"activity_status": "never_active", "last_activity_at": None}

    latest_activity = max(activity_timestamps)
    reference_now = now or datetime.now(timezone.utc)
    if reference_now.tzinfo is None:
        reference_now = reference_now.replace(tzinfo=timezone.utc)
    threshold_days = (
        max(1, min(inactive_after_days, 3650))
        if inactive_after_days is not None
        else _configured_inactive_after_days()
    )
    activity_status = (
        "inactive"
        if reference_now - latest_activity > timedelta(days=threshold_days)
        else "active"
    )
    return {
        "activity_status": activity_status,
        "last_activity_at": latest_activity,
    }


__all__ = [
    "DEFAULT_INACTIVE_AFTER_DAYS",
    "derive_user_activity",
]
