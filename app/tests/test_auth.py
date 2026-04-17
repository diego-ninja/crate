"""Tests for the auth system (JWT, password hashing, middleware, API endpoints)."""

from unittest.mock import patch, MagicMock, AsyncMock
from datetime import datetime, timezone, timedelta

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from tests.conftest import PG_AVAILABLE


# ── Unit tests for crate.auth (no DB needed) ──────────────────────


class TestPasswordHashing:
    def test_hash_and_verify(self):
        from crate.auth import hash_password, verify_password
        pw = "s3cret!Pass"
        hashed = hash_password(pw)
        assert hashed != pw
        assert verify_password(pw, hashed)

    def test_wrong_password_fails(self):
        from crate.auth import hash_password, verify_password
        hashed = hash_password("correct")
        assert not verify_password("wrong", hashed)

    def test_different_hashes_for_same_password(self):
        from crate.auth import hash_password
        h1 = hash_password("same")
        h2 = hash_password("same")
        assert h1 != h2  # bcrypt salt should differ


class TestJWT:
    @patch("crate.auth._get_jwt_secret", return_value="test-secret-key-1234")
    def test_create_and_verify(self, _mock_secret):
        from crate.auth import create_jwt, verify_jwt
        token = create_jwt(42, "user@test.com", "admin", username="testuser", name="Test")
        payload = verify_jwt(token)
        assert payload is not None
        assert payload["user_id"] == 42
        assert payload["email"] == "user@test.com"
        assert payload["role"] == "admin"
        assert payload["username"] == "testuser"
        assert payload["name"] == "Test"

    @patch("crate.auth._get_jwt_secret", return_value="test-secret-key-1234")
    def test_expired_token_returns_none(self, _mock_secret):
        import jwt as pyjwt
        from crate.auth import verify_jwt, JWT_ALGORITHM
        payload = {
            "user_id": 1,
            "email": "x@x.com",
            "role": "user",
            "iat": datetime.now(timezone.utc) - timedelta(hours=48),
            "exp": datetime.now(timezone.utc) - timedelta(hours=24),
        }
        token = pyjwt.encode(payload, "test-secret-key-1234", algorithm=JWT_ALGORITHM)
        assert verify_jwt(token) is None

    @patch("crate.auth._get_jwt_secret", return_value="test-secret-key-1234")
    def test_tampered_token_returns_none(self, _mock_secret):
        from crate.auth import create_jwt, verify_jwt
        token = create_jwt(1, "a@b.com", "user")
        header, payload, signature = token.split(".")
        tampered_signature = ("A" if signature[0] != "A" else "B") + signature[1:]
        tampered = ".".join([header, payload, tampered_signature])
        assert verify_jwt(tampered) is None

    @patch("crate.auth._get_jwt_secret", return_value="key-A")
    def test_wrong_secret_returns_none(self, _mock_secret):
        import jwt as pyjwt
        from crate.auth import verify_jwt, JWT_ALGORITHM
        payload = {
            "user_id": 1, "email": "a@b.com", "role": "user",
            "iat": datetime.now(timezone.utc),
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        }
        token = pyjwt.encode(payload, "key-B", algorithm=JWT_ALGORITHM)
        assert verify_jwt(token) is None


class TestGetJwtSecret:
    @patch.dict("os.environ", {"JWT_SECRET": "env-secret"})
    def test_env_var_takes_precedence(self):
        from crate.auth import _get_jwt_secret
        assert _get_jwt_secret() == "env-secret"

    @patch.dict("os.environ", {}, clear=True)
    @patch("crate.auth.get_setting", return_value="stored-secret")
    def test_falls_back_to_db_setting(self, mock_get):
        import os
        os.environ.pop("JWT_SECRET", None)
        from crate.auth import _get_jwt_secret
        assert _get_jwt_secret() == "stored-secret"

    @patch.dict("os.environ", {}, clear=True)
    @patch("crate.auth.set_setting")
    @patch("crate.auth.get_setting", return_value=None)
    def test_generates_and_stores_if_missing(self, mock_get, mock_set):
        import os
        os.environ.pop("JWT_SECRET", None)
        from crate.auth import _get_jwt_secret
        secret = _get_jwt_secret()
        assert len(secret) == 64  # token_hex(32) = 64 hex chars
        mock_set.assert_called_once_with("jwt_secret", secret)


# ── API endpoint tests ─────────────────────────────────────────────


class TestLoginEndpoint:
    def test_login_success(self, test_app):
        fake_user = {
            "id": 1, "email": "test@test.com", "name": "Test",
            "avatar": None, "role": "admin", "username": "admin",
            "password_hash": "$2b$12$realhashdoesntmatterhere",
        }
        fake_session = {
            "id": "sess-123",
            "expires_at": datetime.now(timezone.utc).isoformat(),
        }
        with patch("crate.api.auth.get_user_by_email", return_value=fake_user), \
             patch("crate.api.auth.verify_password", return_value=True), \
             patch("crate.api.auth.update_user_last_login"), \
             patch("crate.api.auth._create_login_session", return_value=("fake-jwt", fake_session)):
            resp = test_app.post("/api/auth/login", json={"email": "test@test.com", "password": "pass"})
            assert resp.status_code == 200
            data = resp.json()
            assert data["email"] == "test@test.com"
            assert data["session"]["id"] == "sess-123"
            # Cookie is set with secure=True so TestClient (HTTP) may not expose it in resp.cookies;
            # check the Set-Cookie header directly
            set_cookie = resp.headers.get("set-cookie", "")
            assert "crate_session" in set_cookie

    def test_login_wrong_password(self, test_app):
        fake_user = {
            "id": 1, "email": "test@test.com", "name": "Test",
            "avatar": None, "role": "admin", "password_hash": "somehash",
        }
        with patch("crate.api.auth.get_user_by_email", return_value=fake_user), \
             patch("crate.api.auth.verify_password", return_value=False):
            resp = test_app.post("/api/auth/login", json={"email": "test@test.com", "password": "wrong"})
            assert resp.status_code == 401

    def test_login_unknown_email(self, test_app):
        with patch("crate.api.auth.get_user_by_email", return_value=None):
            resp = test_app.post("/api/auth/login", json={"email": "nobody@x.com", "password": "x"})
            assert resp.status_code == 401


class TestRegisterEndpoint:
    def test_first_user_no_auth_needed(self, test_app):
        """First user registration should work without admin auth."""
        fake_user = {"id": 1, "email": "new@test.com", "name": "New", "avatar": None, "role": "user", "username": None}
        fake_session = {"id": "sess123", "user_id": 1}

        with patch("crate.api.auth.count_users", return_value=0), \
             patch("crate.api.auth.get_setting", return_value=None), \
             patch("crate.api.auth.get_user_by_email", return_value=None), \
             patch("crate.api.auth.hash_password", return_value="hashed"), \
             patch("crate.api.auth.create_user", return_value=fake_user), \
             patch("crate.api.auth.update_user_last_login"), \
             patch("crate.api.auth.create_session", return_value=fake_session), \
             patch("crate.api.auth.create_jwt", return_value="jwt-token"):
            resp = test_app.post("/api/auth/register", json={"email": "new@test.com", "password": "secretpw1"})
            assert resp.status_code == 201

    def test_duplicate_email_returns_409(self, test_app):
        existing_user = {"id": 1, "email": "taken@test.com"}

        with patch("crate.api.auth.count_users", return_value=0), \
             patch("crate.api.auth.get_setting", return_value=None), \
             patch("crate.api.auth.get_user_by_email", return_value=existing_user):
            resp = test_app.post("/api/auth/register", json={"email": "taken@test.com", "password": "longpassword1"})
            assert resp.status_code == 409


class TestAuthMiddleware:
    """Test the AuthMiddleware without mocking (test_app mocks it, so we test the class directly)."""

    def test_require_auth_raises_401_when_no_user(self):
        from crate.api.auth import _require_auth
        from fastapi import HTTPException
        mock_request = MagicMock()
        mock_request.state.user = None
        with pytest.raises(HTTPException) as exc_info:
            _require_auth(mock_request)
        assert exc_info.value.status_code == 401

    def test_require_admin_raises_403_for_non_admin(self):
        from crate.api.auth import _require_admin
        from fastapi import HTTPException
        mock_request = MagicMock()
        mock_request.state.user = {"id": 1, "email": "a@b.com", "role": "user"}
        with pytest.raises(HTTPException) as exc_info:
            _require_admin(mock_request)
        assert exc_info.value.status_code == 403

    def test_require_admin_passes_for_admin(self):
        from crate.api.auth import _require_admin
        mock_request = MagicMock()
        mock_request.state.user = {"id": 1, "email": "a@b.com", "role": "admin"}
        user = _require_admin(mock_request)
        assert user["role"] == "admin"


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
class TestAuthIntegration:
    @pytest.fixture
    def real_auth_client(self, pg_db, tmp_path):
        from fastapi.testclient import TestClient

        mock_config = {
            "library_path": str(tmp_path),
            "audio_extensions": [".flac", ".mp3", ".m4a"],
            "exclude_dirs": [],
        }

        with patch("crate.api._deps.load_config", return_value=mock_config):
            from crate.api import create_app

            app = create_app()
            with TestClient(app) as client:
                yield client

    def test_pg_db_seeds_default_admin(self, pg_db):
        admin = pg_db.get_user_by_email("admin@cratemusic.app")

        assert admin is not None
        assert admin["username"] == "admin"
        assert admin["role"] == "admin"
        assert admin["password_hash"]

    def test_login_seeded_admin_creates_session(self, real_auth_client, pg_db):
        admin = pg_db.get_user_by_email("admin@cratemusic.app")

        resp = real_auth_client.post(
            "/api/auth/login",
            json={"email": "admin@cratemusic.app", "password": "admin"},
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "admin@cratemusic.app"
        assert data["session"]["id"]

        sessions = pg_db.list_sessions(admin["id"])
        assert any(session["id"] == data["session"]["id"] for session in sessions)

    def test_create_user_reuses_shared_session_for_username_lookup(self, pg_db):
        from crate.db.auth import create_user, get_user_by_id
        from crate.db.tx import transaction_scope

        with transaction_scope() as session:
            with patch("crate.db.auth.transaction_scope", side_effect=AssertionError("nested scope")):
                user = create_user("composed-user@test.com", session=session)
                loaded = get_user_by_id(user["id"], session=session)

        assert loaded is not None
        assert loaded["email"] == "composed-user@test.com"

    def test_update_user_without_fields_reuses_shared_session(self, pg_db):
        from crate.db.auth import create_user, update_user
        from crate.db.tx import transaction_scope

        with transaction_scope() as session:
            user = create_user("update-user@test.com", session=session)
            with patch("crate.db.auth.transaction_scope", side_effect=AssertionError("nested scope")):
                same_user = update_user(user["id"], session=session)

        assert same_user is not None
        assert same_user["id"] == user["id"]

    def test_auth_middleware_uses_current_role_from_db(self, pg_db):
        from crate.api.auth import AuthMiddleware
        from crate.auth import create_jwt

        user = pg_db.create_user("stale-role@test.com", role="user")
        token = create_jwt(user["id"], user["email"], "user", username=user["username"], name=user["name"])
        pg_db.update_user(user["id"], role="admin")

        app = FastAPI()
        app.add_middleware(AuthMiddleware)

        @app.get("/admin-check")
        def admin_check(request: Request):
            from crate.api.auth import _require_admin
            user = _require_admin(request)
            return {"role": user["role"]}

        with TestClient(app) as client:
            client.cookies.set("crate_session", token)
            resp = client.get("/admin-check")

        assert resp.status_code == 200
        assert resp.json()["role"] == "admin"


class TestLogout:
    def test_logout_clears_cookie(self, test_app):
        resp = test_app.post("/api/auth/logout")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
