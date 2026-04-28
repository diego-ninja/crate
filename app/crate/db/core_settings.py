"""Environment-driven settings for the legacy psycopg pool layer."""

from __future__ import annotations

import logging
import os

log = logging.getLogger(__name__)


def get_pg_connection_settings() -> tuple[str, str, str, str, str]:
    user = os.environ.get("CRATE_POSTGRES_USER", "crate")
    password = os.environ.get("CRATE_POSTGRES_PASSWORD", "crate")
    host = os.environ.get("CRATE_POSTGRES_HOST", "crate-postgres")
    port = os.environ.get("CRATE_POSTGRES_PORT", "5432")
    db = os.environ.get("CRATE_POSTGRES_DB", "crate")
    return user, password, host, port, db


def default_legacy_pool_settings() -> tuple[int, int]:
    runtime = os.environ.get("CRATE_RUNTIME", "").lower()
    if runtime == "api":
        return 1, 8
    if runtime == "worker":
        return 1, 4
    return 1, 6


def get_int_setting(env_var: str, default: int, *, minimum: int = 0) -> int:
    raw = os.environ.get(env_var)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        log.warning("Invalid %s=%r; falling back to %d", env_var, raw, default)
        return default
    return max(minimum, value)


def get_dsn() -> str:
    user, password, host, port, db = get_pg_connection_settings()
    return f"postgresql://{user}:{password}@{host}:{port}/{db}"


__all__ = [
    "default_legacy_pool_settings",
    "get_dsn",
    "get_int_setting",
    "get_pg_connection_settings",
]
