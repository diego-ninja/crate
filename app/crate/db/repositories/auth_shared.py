from __future__ import annotations

from datetime import datetime, timedelta, timezone
from functools import lru_cache

ACTIVE_SESSION_WINDOW = timedelta(minutes=3)
RECENT_SESSION_WINDOW = timedelta(days=7)


def model_to_dict(model) -> dict:
    return {column.key: getattr(model, column.key) for column in model.__mapper__.columns}


def coerce_datetime(value: str | datetime | None) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _clean_device_part(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    if not normalized or normalized.lower() == "unknown":
        return None
    return normalized


@lru_cache(maxsize=1024)
def parse_device_details(user_agent: str | None) -> dict[str, str | None]:
    if not user_agent:
        return {
            "client_name": None,
            "client_version": None,
            "os_name": None,
            "os_version": None,
            "device_brand": None,
            "device_model": None,
            "device_type": None,
        }
    try:
        from device_detector import DeviceDetector

        device = DeviceDetector(user_agent).parse()
        return {
            "client_name": _clean_device_part(device.client_name()),
            "client_version": _clean_device_part(device.client_version()),
            "os_name": _clean_device_part(device.os_name()),
            "os_version": _clean_device_part(device.os_version()),
            "device_brand": _clean_device_part(device.device_brand()),
            "device_model": _clean_device_part(device.device_model()),
            "device_type": _clean_device_part(device.device_type()),
        }
    except Exception:
        return {
            "client_name": None,
            "client_version": None,
            "os_name": None,
            "os_version": None,
            "device_brand": None,
            "device_model": None,
            "device_type": None,
        }


def _device_display_from_parts(parts: dict[str, str | None]) -> str | None:
    label_parts: list[str] = []

    device_name = " ".join(part for part in (parts.get("device_brand"), parts.get("device_model")) if part).strip()
    if device_name and parts.get("device_model"):
        label_parts.append(device_name)
    else:
        device_type = parts.get("device_type")
        if device_type == "smartphone":
            label_parts.append("Phone")
        elif device_type:
            label_parts.append(device_type.title())

    os_label = " ".join(part for part in (parts.get("os_name"), parts.get("os_version")) if part).strip()
    if os_label:
        label_parts.append(os_label)

    return " · ".join(label_parts) if label_parts else None


def parse_device_label(user_agent: str | None) -> str | None:
    return _device_display_from_parts(parse_device_details(user_agent))


def session_activity_state(
    *,
    created_at: str | datetime | None,
    last_seen_at: str | datetime | None,
    expires_at: str | datetime | None,
    revoked_at: str | datetime | None,
    now: datetime | None = None,
) -> str:
    current_time = now or datetime.now(timezone.utc)
    revoked = coerce_datetime(revoked_at)
    if revoked is not None:
        return "revoked"

    expires = coerce_datetime(expires_at)
    if expires is not None and expires < current_time:
        return "expired"

    seen_at = coerce_datetime(last_seen_at) or coerce_datetime(created_at)
    if seen_at is None:
        return "history"

    age = current_time - seen_at
    if age <= ACTIVE_SESSION_WINDOW:
        return "active"
    if age <= RECENT_SESSION_WINDOW:
        return "recent"
    return "history"


def build_device_fingerprint(
    *,
    user_agent: str | None,
    device_label: str | None,
    last_seen_ip: str | None = None,
) -> str | None:
    parsed = parse_device_details(user_agent)
    explicit_label = _clean_device_part(device_label)
    fingerprint_parts = [
        parsed.get("device_type"),
        parsed.get("device_brand"),
        parsed.get("device_model"),
        parsed.get("os_name"),
        parsed.get("client_name"),
    ]
    if explicit_label:
        fingerprint_parts.append(explicit_label.lower())
    if not any(fingerprint_parts):
        fallback_ip = _clean_device_part(last_seen_ip)
        if fallback_ip:
            fingerprint_parts.append(fallback_ip)
    normalized_parts = [part.strip().lower() for part in fingerprint_parts if part]
    return "::".join(normalized_parts) if normalized_parts else None


def is_listen_app(app_id: str | None) -> bool:
    normalized = (app_id or "").strip().lower()
    return normalized.startswith("listen")


def enrich_auth_session(session: dict, *, now: datetime | None = None) -> dict:
    enriched = dict(session)
    parsed = parse_device_details(enriched.get("user_agent"))
    display_label = _clean_device_part(enriched.get("device_label")) or _device_display_from_parts(parsed)
    activity_state = session_activity_state(
        created_at=enriched.get("created_at"),
        last_seen_at=enriched.get("last_seen_at"),
        expires_at=enriched.get("expires_at"),
        revoked_at=enriched.get("revoked_at"),
        now=now,
    )
    enriched.update(
        {
            "client_name": parsed.get("client_name"),
            "client_version": parsed.get("client_version"),
            "os_name": parsed.get("os_name"),
            "os_version": parsed.get("os_version"),
            "device_brand": parsed.get("device_brand"),
            "device_model": parsed.get("device_model"),
            "device_type": parsed.get("device_type"),
            "display_label": display_label,
            "device_fingerprint": build_device_fingerprint(
                user_agent=enriched.get("user_agent"),
                device_label=display_label,
                last_seen_ip=enriched.get("last_seen_ip"),
            ),
            "activity_state": activity_state,
            "is_active": activity_state == "active",
            "is_recent": activity_state in {"active", "recent"},
        }
    )
    return enriched


def promote_now_playing_session(
    sessions: list[dict],
    *,
    now_playing: dict | None,
    now: datetime | None = None,
) -> list[dict]:
    if not sessions or not now_playing:
        return sessions

    app_platform = (now_playing.get("app_platform") or "").strip().lower()
    if not is_listen_app(app_platform):
        return sessions

    current_time = now or datetime.now(timezone.utc)
    candidate_index: int | None = None
    candidate_seen_at: datetime | None = None

    for index, session in enumerate(sessions):
        if not is_listen_app(session.get("app_id")):
            continue
        if session.get("revoked_at") is not None:
            continue
        expires_at = coerce_datetime(session.get("expires_at"))
        if expires_at is not None and expires_at <= current_time:
            continue

        seen_at = coerce_datetime(session.get("last_seen_at")) or coerce_datetime(session.get("created_at"))
        if seen_at is None:
            continue
        if candidate_seen_at is None or seen_at > candidate_seen_at:
            candidate_index = index
            candidate_seen_at = seen_at

    if candidate_index is None:
        return sessions

    promoted = dict(sessions[candidate_index])
    promoted["activity_state"] = "active"
    promoted["is_active"] = True
    promoted["is_recent"] = True

    updated = list(sessions)
    updated[candidate_index] = promoted
    return updated


__all__ = [
    "ACTIVE_SESSION_WINDOW",
    "RECENT_SESSION_WINDOW",
    "build_device_fingerprint",
    "coerce_datetime",
    "enrich_auth_session",
    "is_listen_app",
    "model_to_dict",
    "parse_device_details",
    "parse_device_label",
    "promote_now_playing_session",
    "session_activity_state",
]
