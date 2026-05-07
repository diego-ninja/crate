from __future__ import annotations

from datetime import date, datetime, timezone
import hashlib


def _coerce_datetime(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc)
    if not value:
        return None
    text_val = str(value).strip()
    if not text_val:
        return None
    try:
        if "T" in text_val:
            parsed = datetime.fromisoformat(text_val.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        parsed_date = date.fromisoformat(text_val)
        return datetime.combine(parsed_date, datetime.min.time(), tzinfo=timezone.utc)
    except ValueError:
        return None


def _coerce_date(value: object) -> date | None:
    parsed = _coerce_datetime(value)
    return parsed.date() if parsed else None


def _daily_rotation_index(pool_size: int, user_id: int) -> int:
    if pool_size <= 1:
        return 0
    seed = f"{date.today().isoformat()}:{max(user_id, 0)}".encode("utf-8")
    digest = hashlib.sha1(seed).digest()
    return int.from_bytes(digest[:4], "big") % pool_size


__all__ = [
    "_coerce_date",
    "_coerce_datetime",
    "_daily_rotation_index",
]
