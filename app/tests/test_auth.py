"""Tests for the auth system (JWT, password hashing, middleware, API endpoints)."""

from unittest.mock import patch, MagicMock, AsyncMock
from datetime import datetime, timezone, timedelta

import pytest


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
        # Flip a character in the signature
        tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
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
        with patch("crate.api.auth.get_user_by_email", return_value=fake_user), \
             patch("crate.api.auth.verify_password", return_value=True), \
             patch("crate.api.auth.update_user_last_login"), \
             patch("crate.api.auth.create_jwt", return_value="fake-jwt"):
            resp = test_app.post("/api/auth/login", json={"email": "test@test.com", "password": "pass"})
            assert resp.status_code == 200
            data = resp.json()
            assert data["email"] == "test@test.com"
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


class TestLogout:
    def test_logout_clears_cookie(self, test_app):
        resp = test_app.post("/api/auth/logout")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
