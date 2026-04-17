"""Alembic migration environment for Crate.

Reads the PostgreSQL DSN from the same environment variables that
``crate.db.core`` uses (``CRATE_POSTGRES_*``). This keeps Alembic and
the runtime app in sync without duplicating configuration.

Both online (connected) and offline (SQL-script) modes are supported,
though Crate only uses online in practice.
"""

import os
import logging

from alembic import context
from sqlalchemy import create_engine, pool

log = logging.getLogger("alembic.env")


def _build_dsn() -> str:
    user = os.environ.get("CRATE_POSTGRES_USER", "crate")
    password = os.environ.get("CRATE_POSTGRES_PASSWORD", "crate")
    host = os.environ.get("CRATE_POSTGRES_HOST", "postgres")
    port = os.environ.get("CRATE_POSTGRES_PORT", "5432")
    db = os.environ.get("CRATE_POSTGRES_DB", "crate")
    return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{db}"


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode — emit SQL to stdout."""
    context.configure(
        url=_build_dsn(),
        target_metadata=None,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live database connection."""
    connectable = create_engine(
        _build_dsn(),
        poolclass=pool.NullPool,  # short-lived — one connection, done
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=None)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
