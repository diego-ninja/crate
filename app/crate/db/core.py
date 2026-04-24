import logging
import os
import time
from contextlib import contextmanager

import psycopg2
import psycopg2.extras
import psycopg2.pool
from psycopg2 import sql

log = logging.getLogger(__name__)

_pool: psycopg2.pool.ThreadedConnectionPool | None = None
_db_provisioned = False


def _get_pg_connection_settings() -> tuple[str, str, str, str, str]:
    user = os.environ.get("CRATE_POSTGRES_USER", "crate")
    password = os.environ.get("CRATE_POSTGRES_PASSWORD", "crate")
    host = os.environ.get("CRATE_POSTGRES_HOST", "crate-postgres")
    port = os.environ.get("CRATE_POSTGRES_PORT", "5432")
    db = os.environ.get("CRATE_POSTGRES_DB", "crate")
    return user, password, host, port, db


def _default_legacy_pool_settings() -> tuple[int, int]:
    runtime = os.environ.get("CRATE_RUNTIME", "").lower()
    if runtime == "api":
        return 1, 8
    if runtime == "worker":
        return 1, 4
    return 1, 6


def _get_int_setting(env_var: str, default: int, *, minimum: int = 0) -> int:
    raw = os.environ.get(env_var)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        log.warning("Invalid %s=%r; falling back to %d", env_var, raw, default)
        return default
    return max(minimum, value)


def _reset_pool():
    """Reset the connection pool. Must be called after fork() in child processes.
    Does NOT close connections — they belong to the parent process."""
    global _pool
    _pool = None


def _get_dsn() -> str:
    user, password, host, port, db = _get_pg_connection_settings()
    return f"postgresql://{user}:{password}@{host}:{port}/{db}"


def _ensure_database():
    """Create the app user and database if they don't exist.
    Connects as the Postgres superuser (POSTGRES_SUPERUSER_*) to provision
    the app-level role (CRATE_POSTGRES_*). Idempotent and safe to call on
    every startup. Skips silently if superuser creds are not available."""
    global _db_provisioned
    if _db_provisioned:
        return
    _db_provisioned = True

    su_user = os.environ.get("POSTGRES_SUPERUSER_USER")
    su_pass = os.environ.get("POSTGRES_SUPERUSER_PASSWORD")
    if not su_user:
        return  # No superuser creds — assume app user already exists

    app_user, app_pass, host, port, app_db = _get_pg_connection_settings()

    if su_user == app_user:
        return  # Same user, nothing to provision

    try:
        su_db = os.environ.get("POSTGRES_SUPERUSER_DB", "postgres")
        conn = psycopg2.connect(
            host=host, port=port, user=su_user, password=su_pass,
            dbname=su_db,
        )
        conn.autocommit = True
        cur = conn.cursor()

        # Create app role if missing
        cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (app_user,))
        if not cur.fetchone():
            cur.execute(
                sql.SQL("CREATE ROLE {} WITH LOGIN PASSWORD %s").format(sql.Identifier(app_user)),
                (app_pass,),
            )
            log.info("Created database role: %s", app_user)

        # Create app database if missing
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (app_db,))
        if not cur.fetchone():
            cur.execute(
                sql.SQL("CREATE DATABASE {} OWNER {}").format(
                    sql.Identifier(app_db),
                    sql.Identifier(app_user),
                )
            )
            log.info("Created database: %s", app_db)

        # Ensure ownership
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


def _ensure_optional_superuser_extension(extension_name: str) -> bool:
    """Best-effort enablement for optional extensions that need superuser.

    This is intentionally non-fatal: if the server has not been restarted with
    the required preload libraries yet, or the configured role cannot create the
    extension, startup should continue and the logs should make the missing
    observability explicit.
    """
    su_user = os.environ.get("POSTGRES_SUPERUSER_USER")
    su_pass = os.environ.get("POSTGRES_SUPERUSER_PASSWORD")
    if not su_user:
        log.info("Skipping optional extension %s: no superuser credentials configured", extension_name)
        return False

    _, _, host, port, app_db = _get_pg_connection_settings()

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


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None or _pool.closed:
        _ensure_database()
        default_minconn, default_maxconn = _default_legacy_pool_settings()
        minconn = _get_int_setting("CRATE_LEGACY_POOL_MINCONN", default_minconn, minimum=1)
        maxconn = _get_int_setting("CRATE_LEGACY_POOL_MAXCONN", default_maxconn, minimum=minconn)
        for attempt in range(10):
            try:
                _pool = psycopg2.pool.ThreadedConnectionPool(
                    minconn=minconn, maxconn=maxconn, dsn=_get_dsn()
                )
                log.info("Legacy DB pool created (minconn=%s, maxconn=%s)", minconn, maxconn)
                break
            except psycopg2.OperationalError:
                if attempt < 9:
                    time.sleep(2)
                else:
                    raise
    return _pool


def get_db():
    pool = _get_pool()
    conn = pool.getconn()
    return conn


@contextmanager
def get_db_ctx():
    pool = _get_pool()
    for attempt in range(3):
        try:
            conn = pool.getconn()
            break
        except psycopg2.pool.PoolError:
            if attempt < 2:
                time.sleep(0.5)
            else:
                raise
    try:
        conn.autocommit = False
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            cur.close()
        except Exception:
            pass
        pool.putconn(conn)


_MIGRATION_LOCK_ID = 820149  # arbitrary unique advisory lock ID for init_db


def init_db():
    # Acquire an advisory lock so only one process (API or worker) runs
    # schema migrations at a time.  The lock is automatically released
    # when the connection is returned to the pool.
    pool = _get_pool()
    lock_conn = pool.getconn()
    try:
        lock_conn.autocommit = True
        with lock_conn.cursor() as lc:
            lc.execute("SELECT pg_advisory_lock(%s)", (_MIGRATION_LOCK_ID,))
        _init_db_inner()
    finally:
        try:
            lock_conn.autocommit = True
            with lock_conn.cursor() as lc:
                lc.execute("SELECT pg_advisory_unlock(%s)", (_MIGRATION_LOCK_ID,))
        except Exception:
            pass
        pool.putconn(lock_conn)


# ---------------------------------------------------------------------------
# Schema + Migrations
# ---------------------------------------------------------------------------

def _init_db_inner():
    # Alembic is the authoritative bootstrap and upgrade path.
    # The pre-Alembic bridge has been removed from runtime.
    _run_alembic_upgrade()

    # Observability extensions are optional and may require a server restart
    # with shared_preload_libraries before they can be created successfully.
    _ensure_optional_superuser_extension("pg_stat_statements")

    # Seeds run last — they depend on the schema being fully up to date.
    from crate.db.tx import transaction_scope
    with transaction_scope() as session:
        from crate.genre_taxonomy import seed_genre_taxonomy
        from crate.db.repositories.auth import _seed_admin
        seed_genre_taxonomy(session)
        _seed_admin(session)


def _run_alembic_upgrade():
    """Run ``alembic upgrade head`` programmatically.

    Uses the same DSN env vars as the rest of the app. The advisory
    lock in ``init_db()`` ensures only one process runs this at a time.
    """
    import os
    from alembic.config import Config
    from alembic import command

    # Locate alembic.ini relative to the app directory (one level up
    # from crate/db/core.py → app/).
    app_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ini_path = os.path.join(app_dir, "alembic.ini")

    if not os.path.exists(ini_path):
        log.warning("alembic.ini not found at %s — skipping Alembic migrations", ini_path)
        return

    alembic_cfg = Config(ini_path)
    # Override script_location to be absolute so it works regardless of cwd
    alembic_cfg.set_main_option(
        "script_location",
        os.path.join(app_dir, "crate", "db", "migrations"),
    )

    try:
        command.upgrade(alembic_cfg, "head")
        log.info("Alembic migrations applied successfully (head)")
    except Exception as exc:
        log.error("Alembic migration failed: %s", exc)
        raise
