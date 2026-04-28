import logging
import time
from contextlib import contextmanager

import psycopg2
import psycopg2.extras
import psycopg2.pool

from crate.db.core_migrations import run_alembic_upgrade
from crate.db.core_provisioning import (
    ensure_database,
    ensure_optional_superuser_extension,
)
from crate.db.core_settings import (
    default_legacy_pool_settings,
    get_dsn,
    get_int_setting,
    get_pg_connection_settings,
)

log = logging.getLogger(__name__)

_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def _reset_pool():
    """Reset the connection pool. Must be called after fork() in child processes.
    Does NOT close connections — they belong to the parent process."""
    global _pool
    _pool = None

def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None or _pool.closed:
        ensure_database()
        default_minconn, default_maxconn = default_legacy_pool_settings()
        minconn = get_int_setting("CRATE_LEGACY_POOL_MINCONN", default_minconn, minimum=1)
        maxconn = get_int_setting("CRATE_LEGACY_POOL_MAXCONN", default_maxconn, minimum=minconn)
        for attempt in range(10):
            try:
                _pool = psycopg2.pool.ThreadedConnectionPool(
                    minconn=minconn, maxconn=maxconn, dsn=get_dsn()
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
    run_alembic_upgrade()

    # Observability extensions are optional and may require a server restart
    # with shared_preload_libraries before they can be created successfully.
    ensure_optional_superuser_extension("pg_stat_statements")

    # Seeds run last — they depend on the schema being fully up to date.
    from crate.db.tx import transaction_scope
    with transaction_scope() as session:
        from crate.genre_taxonomy import seed_genre_taxonomy
        from crate.db.repositories.auth import _seed_admin
        seed_genre_taxonomy(session)
        _seed_admin(session)
