"""Provisioning helpers for the legacy psycopg pool bootstrap."""

from __future__ import annotations

import logging
import os

import psycopg2
from psycopg2 import sql

from crate.db.core_settings import get_pg_connection_settings

log = logging.getLogger(__name__)

_db_provisioned = False


def ensure_database() -> None:
    """Create the app user and database if they don't exist."""
    global _db_provisioned
    if _db_provisioned:
        return
    _db_provisioned = True

    su_user = os.environ.get("POSTGRES_SUPERUSER_USER")
    su_pass = os.environ.get("POSTGRES_SUPERUSER_PASSWORD")
    if not su_user:
        return

    app_user, app_pass, host, port, app_db = get_pg_connection_settings()

    if su_user == app_user:
        return

    try:
        su_db = os.environ.get("POSTGRES_SUPERUSER_DB", "postgres")
        conn = psycopg2.connect(
            host=host, port=port, user=su_user, password=su_pass, dbname=su_db
        )
        conn.autocommit = True
        cur = conn.cursor()

        cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (app_user,))
        if not cur.fetchone():
            cur.execute(
                sql.SQL("CREATE ROLE {} WITH LOGIN PASSWORD %s").format(sql.Identifier(app_user)),
                (app_pass,),
            )
            log.info("Created database role: %s", app_user)

        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (app_db,))
        if not cur.fetchone():
            cur.execute(
                sql.SQL("CREATE DATABASE {} OWNER {}").format(
                    sql.Identifier(app_db),
                    sql.Identifier(app_user),
                )
            )
            log.info("Created database: %s", app_db)

        cur.execute(
            sql.SQL("ALTER DATABASE {} OWNER TO {}").format(
                sql.Identifier(app_db),
                sql.Identifier(app_user),
            )
        )

        cur.close()
        conn.close()
    except Exception:
        log.debug("Could not provision app database (superuser may not be available)", exc_info=True)


def ensure_optional_superuser_extension(extension_name: str) -> bool:
    """Best-effort enablement for optional extensions that need superuser."""
    su_user = os.environ.get("POSTGRES_SUPERUSER_USER")
    su_pass = os.environ.get("POSTGRES_SUPERUSER_PASSWORD")
    if not su_user:
        log.info("Skipping optional extension %s: no superuser credentials configured", extension_name)
        return False

    _, _, host, port, app_db = get_pg_connection_settings()

    try:
        conn = psycopg2.connect(
            host=host,
            port=port,
            user=su_user,
            password=su_pass,
            dbname=app_db,
        )
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM pg_extension WHERE extname = %s", (extension_name,))
        if cur.fetchone():
            cur.close()
            conn.close()
            return True

        cur.execute(
            sql.SQL("CREATE EXTENSION IF NOT EXISTS {}").format(sql.Identifier(extension_name))
        )
        cur.close()
        conn.close()
        log.info("Enabled optional PostgreSQL extension: %s", extension_name)
        return True
    except Exception:
        log.warning(
            "Optional PostgreSQL extension %s could not be enabled yet; "
            "ensure the server was restarted with the required preload settings",
            extension_name,
            exc_info=True,
        )
        return False


__all__ = ["ensure_database", "ensure_optional_superuser_extension"]
