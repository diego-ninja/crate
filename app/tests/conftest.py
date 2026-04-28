"""Shared test fixtures for the Crate backend test suite.

PostgreSQL strategy (cascading):
  1. If env vars point to an existing PG (e.g. the dev container), use it.
  2. If Docker is available, spin up a PG 15 container via Testcontainers.
  3. If neither works, tests that need PG are skipped.

This keeps "pytest just works" on CI (Docker available) AND on a laptop
where the dev stack is already running.
"""

import atexit
import os
import sys
import types
from contextlib import suppress
from unittest.mock import MagicMock

import pytest

# ── Mock psycopg2 if not installed ──────────────────────────────────

try:
    import psycopg2
    _HAS_PSYCOPG2 = True
except ImportError:
    _HAS_PSYCOPG2 = False
    _mock_psycopg2 = types.ModuleType("psycopg2")
    _mock_psycopg2.extras = types.ModuleType("psycopg2.extras")
    _mock_psycopg2.pool = types.ModuleType("psycopg2.pool")
    _mock_psycopg2.sql = types.ModuleType("psycopg2.sql")
    _mock_psycopg2.extras.RealDictCursor = MagicMock()
    _mock_psycopg2.pool.ThreadedConnectionPool = MagicMock()
    _mock_psycopg2.OperationalError = Exception
    sys.modules["psycopg2"] = _mock_psycopg2
    sys.modules["psycopg2.extras"] = _mock_psycopg2.extras
    sys.modules["psycopg2.pool"] = _mock_psycopg2.pool
    sys.modules["psycopg2.sql"] = _mock_psycopg2.sql

# Mock other optional deps that may not be installed locally
for mod_name in (
    "musicbrainzngs", "mutagen", "watchdog", "thefuzz", "thefuzz.fuzz",
    "rich", "beets", "librosa", "soundfile",
    "jwt", "bcrypt",
):
    if mod_name not in sys.modules:
        try:
            __import__(mod_name)
        except ImportError:
            mock_mod = MagicMock()
            mock_mod.__version__ = "0.0.0"
            sys.modules[mod_name] = mock_mod

# ── PostgreSQL availability (cascading strategy) ───────────────────

PG_AVAILABLE = False
_test_dsn = None   # type: str | None
_tc_container = None  # Testcontainers instance, kept alive for session
TEST_DB_NAME = "crate_test"


def _try_env_pg() -> bool:
    """Try connecting to a PG instance for testing.

    CRITICAL: always uses ``crate_test`` as database name, never the
    main application database. The pg_db fixture does
    ``DROP SCHEMA public CASCADE`` on every test — running that against
    the real database would wipe all user data.
    """
    global PG_AVAILABLE, _test_dsn
    if not _HAS_PSYCOPG2:
        return False
    try:
        user = os.environ.get("CRATE_POSTGRES_USER", "crate")
        password = os.environ.get("CRATE_POSTGRES_PASSWORD", "crate")
        host = os.environ.get("CRATE_POSTGRES_HOST", "localhost")
        port = os.environ.get("CRATE_POSTGRES_PORT", "5432")

        # ALWAYS use crate_test — NEVER read CRATE_POSTGRES_DB here.
        # The test fixture drops the entire public schema on every test.
        db = TEST_DB_NAME

        # Try to create the test database if it doesn't exist yet.
        try:
            admin_dsn = f"postgresql://{user}:{password}@{host}:{port}/{user}"
            admin_conn = psycopg2.connect(admin_dsn)
            admin_conn.autocommit = True
            with admin_conn.cursor() as c:
                c.execute("SELECT 1 FROM pg_database WHERE datname = %s", (TEST_DB_NAME,))
                if not c.fetchone():
                    # TEST_DB_NAME is a constant ("crate_test") — safe to
                    # interpolate as an identifier. DDL params can't use %s.
                    from psycopg2 import sql as _sql
                    c.execute(_sql.SQL("CREATE DATABASE {} OWNER {}").format(
                        _sql.Identifier(TEST_DB_NAME), _sql.Identifier(user),
                    ))
            admin_conn.close()
        except Exception:
            pass

        dsn = f"postgresql://{user}:{password}@{host}:{port}/{db}"
        conn = psycopg2.connect(dsn)
        conn.close()
        # Pin the pytest process to the test DB early so any accidental
        # import-time DB access cannot hit the local dev database.
        os.environ["CRATE_POSTGRES_DB"] = TEST_DB_NAME
        os.environ.setdefault("POSTGRES_SUPERUSER_USER", user)
        os.environ.setdefault("POSTGRES_SUPERUSER_PASSWORD", password)
        os.environ.setdefault("POSTGRES_SUPERUSER_DB", TEST_DB_NAME)
        _test_dsn = dsn
        PG_AVAILABLE = True
        return True
    except Exception:
        return False


def _try_testcontainers() -> bool:
    """Spin up a PG 15 container via testcontainers-python."""
    global PG_AVAILABLE, _test_dsn, _tc_container
    if not _HAS_PSYCOPG2:
        return False
    try:
        from testcontainers.postgres import PostgresContainer
    except ImportError:
        return False
    try:
        container = PostgresContainer(
            image="pgvector/pgvector:pg15",
            username="crate",
            password="crate",
            dbname=TEST_DB_NAME,
        )
        container.start()

        # Extract connection params and set env vars so init_db() picks
        # them up without any extra plumbing.
        host = container.get_container_host_ip()
        port = container.get_exposed_port(5432)
        os.environ["CRATE_POSTGRES_USER"] = "crate"
        os.environ["CRATE_POSTGRES_PASSWORD"] = "crate"
        os.environ["CRATE_POSTGRES_HOST"] = host
        os.environ["CRATE_POSTGRES_PORT"] = str(port)
        os.environ["CRATE_POSTGRES_DB"] = TEST_DB_NAME
        os.environ["POSTGRES_SUPERUSER_USER"] = "crate"
        os.environ["POSTGRES_SUPERUSER_PASSWORD"] = "crate"
        os.environ["POSTGRES_SUPERUSER_DB"] = TEST_DB_NAME

        dsn = f"postgresql://crate:crate@{host}:{port}/{TEST_DB_NAME}"

        # Verify connectivity
        conn = psycopg2.connect(dsn)
        conn.close()

        _test_dsn = dsn
        _tc_container = container
        PG_AVAILABLE = True
        return True
    except Exception as exc:
        print(f"[conftest] Testcontainers PG failed: {exc}")
        return False


# Run the cascade once at import time
if not _try_env_pg():
    _try_testcontainers()


def _shutdown_tc():
    global _tc_container
    if _tc_container is not None:
        with suppress(Exception):
            _tc_container.stop()
        _tc_container = None


atexit.register(_shutdown_tc)


# ── Fixtures ───────────────────────────────────────────────────────

@pytest.fixture
def pg_db():
    """Provide a clean test database with all tables created.

    Drops and recreates the public schema on every test so tests are
    fully isolated. The init_db() call creates all tables + seeds
    defaults (admin user, genre taxonomy, etc.).
    """
    if not PG_AVAILABLE or not _test_dsn:
        pytest.skip("PostgreSQL not available")

    # FORCE all DB access to use crate_test for the duration of this
    # fixture. Without this, init_db() and db functions would use the
    # env var CRATE_POSTGRES_DB which may point at the real database.
    os.environ["CRATE_POSTGRES_DB"] = TEST_DB_NAME
    if not _test_dsn.endswith(f"/{TEST_DB_NAME}"):
        raise RuntimeError(f"Refusing to run pg_db against non-test DSN: {_test_dsn!r}")
    original_admin_password = os.environ.get("DEFAULT_ADMIN_PASSWORD")
    if not original_admin_password:
        os.environ["DEFAULT_ADMIN_PASSWORD"] = "admin"

    conn = psycopg2.connect(_test_dsn)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("DROP SCHEMA IF EXISTS public CASCADE")
    cur.execute("CREATE SCHEMA public")
    cur.execute("GRANT ALL ON SCHEMA public TO PUBLIC")
    cur.close()
    conn.close()

    import crate.db as db_mod
    import crate.db.core as db_core

    # Reset BOTH connection pools so init_db() and transaction_scope()
    # create fresh ones pointing at the test database (crate_test).
    if db_core._pool is not None:
        with suppress(Exception):
            db_core._pool.closeall()
        db_core._pool = None

    # Also reset the SQLAlchemy engine — it caches the DSN from first
    # creation. Without this, transaction_scope() would still talk to
    # the main database even though env says crate_test.
    from crate.db.engine import reset_engine
    reset_engine()

    db_mod.init_db()
    try:
        yield db_mod
    finally:
        if db_core._pool is not None:
            with suppress(Exception):
                db_core._pool.closeall()
            db_core._pool = None
        reset_engine()
        if original_admin_password is None:
            os.environ.pop("DEFAULT_ADMIN_PASSWORD", None)
        else:
            os.environ["DEFAULT_ADMIN_PASSWORD"] = original_admin_password


@pytest.fixture
def test_app():
    """Provide a FastAPI TestClient with mocked DB layer."""
    from unittest.mock import patch

    try:
        from fastapi.testclient import TestClient
    except ImportError:
        pytest.skip("FastAPI/httpx not installed")

    mock_config = {
        "library_path": "/tmp/test_crate_library",
        "audio_extensions": [".flac", ".mp3", ".m4a"],
        "exclude_dirs": [],
    }

    async def _fake_resolve_user(self, request):
        return {
            "id": 1,
            "email": "test@test.com",
            "role": "admin",
            "username": "testadmin",
            "name": "Test Admin",
        }

    with patch("crate.api._deps.load_config", return_value=mock_config), \
         patch("crate.db.init_db"), \
         patch("crate.api.cache_events.broadcast_invalidation"), \
         patch("crate.api.auth.AuthMiddleware.resolve_user", _fake_resolve_user):
        from crate.api import create_app
        app = create_app()
        client = TestClient(app)
        yield client
