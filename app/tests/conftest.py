import os
import sys
import types
from unittest.mock import MagicMock

import pytest

# ── Mock psycopg2 if not installed (allows running tests without PostgreSQL driver) ──

try:
    import psycopg2
    _HAS_PSYCOPG2 = True
except ImportError:
    _HAS_PSYCOPG2 = False
    # Create mock psycopg2 module hierarchy so musicdock.db can be imported
    _mock_psycopg2 = types.ModuleType("psycopg2")
    _mock_psycopg2.extras = types.ModuleType("psycopg2.extras")
    _mock_psycopg2.pool = types.ModuleType("psycopg2.pool")
    _mock_psycopg2.extras.RealDictCursor = MagicMock()
    _mock_psycopg2.pool.ThreadedConnectionPool = MagicMock()
    _mock_psycopg2.OperationalError = Exception
    sys.modules["psycopg2"] = _mock_psycopg2
    sys.modules["psycopg2.extras"] = _mock_psycopg2.extras
    sys.modules["psycopg2.pool"] = _mock_psycopg2.pool

# Mock other optional deps that may not be installed locally
for mod_name in ("musicbrainzngs", "mutagen", "watchdog", "thefuzz", "thefuzz.fuzz",
                 "rich", "beets", "librosa", "soundfile"):
    if mod_name not in sys.modules:
        try:
            __import__(mod_name)
        except ImportError:
            mock_mod = MagicMock()
            mock_mod.__version__ = "0.0.0"
            sys.modules[mod_name] = mock_mod

# ── PostgreSQL availability check ──────────────────────────────────

PG_AVAILABLE = False
_test_dsn = None


def _check_pg():
    global PG_AVAILABLE, _test_dsn
    if not _HAS_PSYCOPG2:
        return
    try:
        user = os.environ.get("MUSICDOCK_POSTGRES_USER", "musicdock")
        password = os.environ.get("MUSICDOCK_POSTGRES_PASSWORD", "musicdock")
        host = os.environ.get("MUSICDOCK_POSTGRES_HOST", "localhost")
        port = os.environ.get("MUSICDOCK_POSTGRES_PORT", "5432")
        db = os.environ.get("MUSICDOCK_POSTGRES_DB", "musicdock_test")
        _test_dsn = f"postgresql://{user}:{password}@{host}:{port}/{db}"
        conn = psycopg2.connect(_test_dsn)
        conn.close()
        PG_AVAILABLE = True
    except Exception:
        PG_AVAILABLE = False


_check_pg()


@pytest.fixture
def pg_db():
    """Provide a clean test database with all tables created."""
    if not PG_AVAILABLE:
        pytest.skip("PostgreSQL not available")

    conn = psycopg2.connect(_test_dsn)
    conn.autocommit = True
    cur = conn.cursor()

    # Drop all tables cleanly
    cur.execute("DROP SCHEMA public CASCADE")
    cur.execute("CREATE SCHEMA public")
    cur.execute("GRANT ALL ON SCHEMA public TO PUBLIC")
    cur.close()
    conn.close()

    os.environ["MUSICDOCK_POSTGRES_HOST"] = os.environ.get("MUSICDOCK_POSTGRES_HOST", "localhost")
    os.environ["MUSICDOCK_POSTGRES_DB"] = os.environ.get("MUSICDOCK_POSTGRES_DB", "musicdock_test")

    import musicdock.db as db_mod
    import musicdock.db.core as db_core
    if db_core._pool is not None:
        try:
            db_core._pool.closeall()
        except Exception:
            pass
        db_core._pool = None

    db_mod.init_db()
    yield db_mod

    if db_core._pool is not None:
        try:
            db_core._pool.closeall()
        except Exception:
            pass
        db_core._pool = None


@pytest.fixture
def test_app():
    """Provide a FastAPI TestClient with mocked DB layer."""
    from unittest.mock import patch, AsyncMock

    try:
        from fastapi.testclient import TestClient
    except ImportError:
        pytest.skip("FastAPI/httpx not installed")

    mock_config = {
        "library_path": "/tmp/test_musicdock_library",
        "audio_extensions": [".flac", ".mp3", ".m4a"],
        "exclude_dirs": [],
    }

    # Mock the AuthMiddleware to always inject a fake admin user
    async def _fake_dispatch(self, request, call_next):
        request.state.user = {
            "id": 1,
            "email": "test@test.com",
            "role": "admin",
            "username": "testadmin",
            "name": "Test Admin",
        }
        return await call_next(request)

    with patch("musicdock.api._deps.load_config", return_value=mock_config), \
         patch("musicdock.db.init_db"), \
         patch("musicdock.api.auth.AuthMiddleware.dispatch", _fake_dispatch):
        from musicdock.api import create_app
        app = create_app()
        client = TestClient(app)
        yield client
