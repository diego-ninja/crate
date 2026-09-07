"""Sentry configuration and privacy safeguards for Crate runtimes."""

from __future__ import annotations

import copy
import os
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import sentry_sdk

_FILTERED = "[Filtered]"
_DEFAULT_TRACE_SAMPLE_RATE = 0.1
_SENSITIVE_QUERY_KEYS = {
    "access_token",
    "api_key",
    "code",
    "media_ticket",
    "password",
    "refresh_token",
    "secret",
    "session",
    "signature",
    "state",
    "token",
}
_SENSITIVE_KEY_PARTS = (
    "authorization",
    "cookie",
    "credential",
    "password",
    "secret",
    "token",
)


@dataclass(frozen=True)
class SentrySettings:
    service: str
    dsn: str | None
    environment: str
    release: str | None
    traces_sample_rate: float
    profiles_sample_rate: float

    @property
    def enabled(self) -> bool:
        return bool(self.dsn)


def load_settings(service: str) -> SentrySettings:
    """Load runtime Sentry settings without requiring Sentry to be enabled."""
    dsn = os.getenv("SENTRY_DSN", "").strip() or None
    enabled = os.getenv("SENTRY_ENABLED", "true").strip().lower()
    if enabled in {"0", "false", "no", "off"}:
        dsn = None

    environment = (
        os.getenv("SENTRY_ENVIRONMENT", "").strip()
        or os.getenv("CRATE_ENV", "").strip()
        or "development"
    )
    release = os.getenv("SENTRY_RELEASE", "").strip() or None
    if release is None:
        git_sha = os.getenv("GITHUB_SHA", "").strip()
        release = f"crate-{git_sha}" if git_sha else None

    return SentrySettings(
        service=service,
        dsn=dsn,
        environment=environment,
        release=release,
        traces_sample_rate=_sample_rate(
            "SENTRY_TRACES_SAMPLE_RATE", _DEFAULT_TRACE_SAMPLE_RATE
        ),
        profiles_sample_rate=_sample_rate("SENTRY_PROFILES_SAMPLE_RATE", 0.0),
    )


def init_sentry(service: str) -> bool:
    """Initialize Sentry once for a process and attach the service tag."""
    settings = load_settings(service)
    if not settings.enabled:
        return False

    if not sentry_sdk.is_initialized():
        init_kwargs: dict[str, Any] = {
            "dsn": settings.dsn,
            "environment": settings.environment,
            "send_default_pii": False,
            "traces_sample_rate": settings.traces_sample_rate,
            "profiles_sample_rate": settings.profiles_sample_rate,
            "before_send": scrub_sentry_event,
            "before_breadcrumb": scrub_sentry_breadcrumb,
        }
        if settings.release:
            init_kwargs["release"] = settings.release
        sentry_sdk.init(**init_kwargs)

    sentry_sdk.set_tag("service", settings.service)
    return True


@contextmanager
def task_scope(task_type: str, task_id: str, queue: str):
    """Attach task metadata and timing to one worker execution."""
    if not sentry_sdk.is_initialized():
        yield None
        return

    with sentry_sdk.push_scope() as scope:
        scope.set_tag("task_type", task_type)
        scope.set_tag("queue", queue)
        scope.set_context("task", {"id": str(task_id), "type": task_type})
        with sentry_sdk.start_span(op="queue.process", name=task_type) as span:
            span.set_data("task_id", str(task_id))
            span.set_data("queue", queue)
            yield span


def scrub_sentry_event(event: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of an event with credentials and PII removed."""
    return _scrub_value(copy.deepcopy(event))


def scrub_sentry_breadcrumb(
    breadcrumb: dict[str, Any], hint: Any = None
) -> dict[str, Any]:
    """Scrub breadcrumb data before it is attached to an event."""
    del hint
    return _scrub_value(copy.deepcopy(breadcrumb))


def _sample_rate(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(1.0, max(0.0, value))


def _scrub_value(value: Any, key: str | None = None) -> Any:
    if key and _is_sensitive_key(key):
        return _FILTERED
    if key == "user" and isinstance(value, dict):
        user_id = value.get("id")
        return {"id": str(user_id)} if user_id is not None else {}
    if isinstance(value, dict):
        return {
            str(item_key): _scrub_value(item, str(item_key))
            for item_key, item in value.items()
        }
    if isinstance(value, list):
        return [_scrub_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_scrub_value(item) for item in value)
    if isinstance(value, str):
        if key in {"url", "query_string"}:
            return _scrub_url_or_query(value, is_url=key == "url")
        return value
    return value


def _is_sensitive_key(key: str) -> bool:
    normalized = key.lower().replace("-", "_")
    return normalized in {"cookies", "set_cookie", "set_cookie_header"} or any(
        part in normalized for part in _SENSITIVE_KEY_PARTS
    )


def _scrub_url_or_query(value: str, *, is_url: bool) -> str:
    if is_url:
        parsed = urlsplit(value)
        if not parsed.query:
            return value
        return urlunsplit(
            (
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                _scrub_query(parsed.query),
                parsed.fragment,
            )
        )
    return _scrub_query(value)


def _scrub_query(query: str) -> str:
    return urlencode(
        [
            (key, _FILTERED if key.lower() in _SENSITIVE_QUERY_KEYS else value)
            for key, value in parse_qsl(query, keep_blank_values=True)
        ],
        safe="[]",
    )
