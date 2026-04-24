from __future__ import annotations

from datetime import datetime, timezone


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


def parse_device_label(user_agent: str | None) -> str | None:
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


__all__ = ["coerce_datetime", "model_to_dict", "parse_device_label"]
