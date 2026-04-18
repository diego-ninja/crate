"""SQLAlchemy 2.x engine and session factory for Crate.

This module is the entry point for all new code that wants to talk to
PostgreSQL through SQLAlchemy rather than the legacy psycopg2 pool in
``core.py``. Both coexist: the legacy pool handles existing code that
uses ``get_db_ctx()``, while this engine handles code that uses
``Session`` (repositories, new queries, ORM models when they arrive).

The two pools are independent — same database, separate connection
lifecycles. This is safe because PostgreSQL handles concurrent
connections from different pools without issue. Over time, as code
migrates from ``get_db_ctx()`` to ``Session``, the legacy pool will
see fewer connections and can eventually be removed.

Configuration reads the same ``CRATE_POSTGRES_*`` env vars as
``core.py``, so there is zero additional setup for operators.
"""

import os
import logging

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

log = logging.getLogger(__name__)


def _build_dsn() -> str:
    user = os.environ.get("CRATE_POSTGRES_USER", "crate")
    password = os.environ.get("CRATE_POSTGRES_PASSWORD", "crate")
    host = os.environ.get("CRATE_POSTGRES_HOST", "crate-postgres")
    port = os.environ.get("CRATE_POSTGRES_PORT", "5432")
    db = os.environ.get("CRATE_POSTGRES_DB", "crate")
    return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{db}"


# Lazy singleton — created on first access so import-time doesn't
# require a live database (tests, CLI tools, etc.).
_engine = None
_session_factory = None


def get_engine():
    """Return the shared SQLAlchemy engine (created on first call)."""
    global _engine
    if _engine is None:
        pool_size = _get_pool_setting("CRATE_SQLALCHEMY_POOL_SIZE", 10)
        max_overflow = _get_pool_setting("CRATE_SQLALCHEMY_MAX_OVERFLOW", 5)
        _engine = create_engine(
            _build_dsn(),
            pool_size=pool_size,
            max_overflow=max_overflow,
            pool_pre_ping=True,
            pool_recycle=3600,
            echo=False,
        )
        log.info(
            "SQLAlchemy engine created: %s (pool_size=%s, max_overflow=%s)",
            _engine.url.render_as_string(hide_password=True),
            pool_size,
            max_overflow,
        )
    return _engine


def get_session_factory():
    """Return the shared session factory (created on first call)."""
    global _session_factory
    if _session_factory is None:
        _session_factory = sessionmaker(
            bind=get_engine(),
            expire_on_commit=False,
        )
    return _session_factory


class Base(DeclarativeBase):
    """Declarative base for future ORM-mapped models.

    Not used yet (Phase 5) but defined here so it's importable as soon
    as anyone wants to create a mapped class. Keeping it next to the
    engine avoids circular imports.
    """
    pass


def _get_pool_setting(env_var: str, default: int) -> int:
    raw = os.environ.get(env_var)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        log.warning("Invalid %s=%r; falling back to %d", env_var, raw, default)
        return default
    return max(0, value)


def reset_engine():
    """Dispose the engine and clear the singleton.

    Used in tests to point at a different database (crate_test) or
    after a fork in worker child processes.
    """
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
        _engine = None
    _session_factory = None
