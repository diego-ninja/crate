"""Tests for the auth system (JWT, password hashing, middleware, API endpoints)."""

import asyncio
import json
from typing import Any
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
    @patch("crate.auth._get_jwt_secret", return_value="test-secret-key-1234-12345678901234")
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

    @patch("crate.auth._get_jwt_secret", return_value="test-secret-key-1234-12345678901234")
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
        token = pyjwt.encode(payload, "test-secret-key-1234-12345678901234", algorithm=JWT_ALGORITHM)
        assert verify_jwt(token) is None

    @patch("crate.auth._get_jwt_secret", return_value="test-secret-key-1234-12345678901234")
    def test_tampered_token_returns_none(self, _mock_secret):
        from crate.auth import create_jwt, verify_jwt
        token = create_jwt(1, "a@b.com", "user")
        header, payload, signature = token.split(".")
        tampered_signature = ("A" if signature[0] != "A" else "B") + signature[1:]
        tampered = ".".join([header, payload, tampered_signature])
        assert verify_jwt(tampered) is None

    @patch("crate.auth._get_jwt_secret", return_value="key-A-1234567890123456789012345678")
    def test_wrong_secret_returns_none(self, _mock_secret):
        import jwt as pyjwt
        from crate.auth import verify_jwt, JWT_ALGORITHM
        payload = {
            "user_id": 1, "email": "a@b.com", "role": "user",
            "iat": datetime.now(timezone.utc),
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        }
        token = pyjwt.encode(payload, "key-B-1234567890123456789012345678", algorithm=JWT_ALGORITHM)
        assert verify_jwt(token) is None


class TestGetJwtSecret:
    @patch.dict("os.environ", {"JWT_SECRET": "env-secret-123456789012345678901234"})
    def test_env_var_takes_precedence(self):
        from crate.auth import _get_jwt_secret
        assert _get_jwt_secret() == "env-secret-123456789012345678901234"

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


class TestOAuthRedirectHelpers:
    def test_append_query_param_preserves_existing_params(self):
        from crate.api.auth import _append_query_param

        url = _append_query_param("https://listen.example/auth/callback?next=%2Fmix", "token", "abc123")

        assert url == "https://listen.example/auth/callback?next=%2Fmix&token=abc123"

    def test_post_auth_redirect_url_adds_token_only_for_web_callback(self):
        from crate.api.auth import _post_auth_redirect_url

        assert (
            _post_auth_redirect_url("https://listen.example/auth/callback?next=%2Fmix", "abc123")
            == "https://listen.example/auth/callback?next=%2Fmix&token=abc123"
        )
        assert _post_auth_redirect_url("https://admin.example/users", "abc123") == "https://admin.example/users"
        assert _post_auth_redirect_url("/auth/callback?next=%2Fmix", "abc123") == "/auth/callback?next=%2Fmix&token=abc123"

    @patch.dict("os.environ", {
        "APPLE_ASSOCIATED_APP_IDS": "",
        "APPLE_TEAM_ID": "TEAM123456",
        "APPLE_LISTEN_BUNDLE_ID": "org.lespedants.crate.listen",
    })
    def test_apple_app_site_association_uses_listen_app_id(self):
        from crate.api.auth import apple_app_site_association

        response = asyncio.run(apple_app_site_association())
        payload = json.loads(response.body)

        assert payload == {
            "applinks": {
                "apps": [],
                "details": [
                    {
                        "appID": "TEAM123456.org.lespedants.crate.listen",
                        "paths": ["/auth/callback*"],
                    }
                ],
            },
        }

    @patch.dict("os.environ", {"APPLE_ASSOCIATED_APP_IDS": "TEAM.one, TEAM.two"}, clear=False)
    def test_apple_app_site_association_supports_multiple_app_ids(self):
        from crate.api.auth import apple_app_site_association

        response = asyncio.run(apple_app_site_association())
        payload = json.loads(response.body)

        assert [item["appID"] for item in payload["applinks"]["details"]] == ["TEAM.one", "TEAM.two"]


class TestOAuthStart:
    @staticmethod
    def _request(headers: list[tuple[bytes, bytes]] | None = None) -> Request:
        return Request(
            {
                "type": "http",
                "method": "POST",
                "path": "/api/auth/oauth/google/start",
                "query_string": b"",
                "headers": headers or [],
                "client": ("127.0.0.1", 12345),
                "scheme": "http",
                "server": ("listen.lespedants.org", 80),
            }
        )

    def test_public_oauth_start_uses_login_mode_even_with_authenticated_request(self):
        from crate.api.auth import oauth_start
        from crate.api.schemas.auth import OAuthStartRequest

        captured_state: dict[str, Any] = {}
        request = self._request()
        request.state.user = {"id": 7, "email": "admin@cratemusic.app", "role": "admin"}

        with patch("crate.api.auth._provider_available", return_value=True), \
             patch("crate.api.auth._build_oauth_state", side_effect=lambda **kwargs: captured_state.update(kwargs) or "state-token"), \
             patch("crate.api.auth._parse_oauth_state", return_value={"verifier": "verifier"}), \
             patch("crate.api.auth._pkce_challenge", return_value="challenge"), \
             patch.dict("os.environ", {"GOOGLE_CLIENT_ID": "google-client"}):
            result = asyncio.run(oauth_start(request, "google", OAuthStartRequest(return_to="https://listen.lespedants.org/auth/callback")))

        assert result["provider"] == "google"
        assert captured_state["mode"] == "login"
        assert captured_state["user_id"] is None

    def test_oauth_link_uses_link_mode_for_current_user(self):
        from crate.api.auth import oauth_link
        from crate.api.schemas.auth import OAuthStartRequest

        captured_state: dict[str, Any] = {}
        request = self._request()
        request.state.user = {"id": 7, "email": "admin@cratemusic.app", "role": "admin"}

        with patch("crate.api.auth._provider_available", return_value=True), \
             patch("crate.api.auth._build_oauth_state", side_effect=lambda **kwargs: captured_state.update(kwargs) or "state-token"), \
             patch("crate.api.auth._parse_oauth_state", return_value={"verifier": "verifier"}), \
             patch("crate.api.auth._pkce_challenge", return_value="challenge"), \
             patch.dict("os.environ", {"GOOGLE_CLIENT_ID": "google-client"}):
            result = asyncio.run(oauth_link(request, "google", OAuthStartRequest(return_to="https://listen.lespedants.org/settings")))

        assert result["provider"] == "google"
        assert captured_state["mode"] == "link"
        assert captured_state["user_id"] == 7

    def test_oauth_link_requires_authentication(self):
        from fastapi import HTTPException

        from crate.api.auth import oauth_link
        from crate.api.schemas.auth import OAuthStartRequest

        request = self._request()
        request.state.user = None

        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(oauth_link(request, "google", OAuthStartRequest(return_to="/settings")))

        assert exc_info.value.status_code == 401

    def test_provider_login_urls_keep_https_behind_proxy(self):
        from crate.api.auth import _provider_status

        request = self._request(headers=[(b"host", b"listen.lespedants.org")])

        with patch.dict("os.environ", {"DOMAIN": "lespedants.org", "GOOGLE_CLIENT_ID": "id", "GOOGLE_CLIENT_SECRET": "secret"}), \
             patch("crate.api.auth.get_setting", return_value=None):
            providers = _provider_status(request)

        assert providers["google"]["login_url"] == "https://listen.lespedants.org/api/auth/google"


class TestAuthUserAvatarProxy:
    @staticmethod
    def _request() -> Request:
        request = Request(
            {
                "type": "http",
                "method": "GET",
                "path": "/api/auth/users/7/avatar",
                "query_string": b"",
                "headers": [],
                "client": ("127.0.0.1", 12345),
                "scheme": "http",
                "server": ("listen.lespedants.org", 80),
            }
        )
        request.state.user = {"id": 1, "email": "user@test.com", "role": "user"}
        return request

    def test_auth_user_avatar_proxies_google_image(self):
        from crate.api.auth import auth_user_avatar

        upstream = MagicMock(
            status_code=200,
            headers={"content-type": "image/jpeg"},
            content=b"avatar-bytes",
        )

        with patch("crate.api.auth.get_user_by_id", return_value={"avatar": "https://lh3.googleusercontent.com/a/avatar"}), \
             patch("crate.api.auth.requests.get", return_value=upstream) as get:
            response = asyncio.run(auth_user_avatar(self._request(), 7))

        assert response.body == b"avatar-bytes"
        assert response.headers["content-type"] == "image/jpeg"
        assert response.headers["cache-control"] == "private, max-age=86400"
        get.assert_called_once()

    def test_auth_user_avatar_rejects_untrusted_hosts(self):
        from fastapi import HTTPException

        from crate.api.auth import auth_user_avatar

        with patch("crate.api.auth.get_user_by_id", return_value={"avatar": "https://example.test/avatar.jpg"}):
            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(auth_user_avatar(self._request(), 7))

        assert exc_info.value.status_code == 404


class TestOAuthCallback:
    @staticmethod
    def _request(path: str = "/api/auth/oauth/google/callback") -> Request:
        return Request(
            {
                "type": "http",
                "method": "GET",
                "path": path,
                "query_string": b"",
                "headers": [],
                "client": ("127.0.0.1", 12345),
                "scheme": "https",
                "server": ("api.example.com", 443),
            }
        )

    def test_google_callback_reuses_legacy_google_id_user(self):
        from crate.api.auth import oauth_callback

        legacy_user = {
            "id": 42,
            "email": "legacy@test.com",
            "role": "user",
            "username": "legacy",
            "name": "Legacy User",
            "google_id": "google-sub-123",
        }

        with patch("crate.api.auth._parse_oauth_state", return_value={
            "provider": "google",
            "return_to": "cratemusic://oauth/callback",
            "mode": "login",
            "verifier": "verifier",
            "app_id": "listen-android",
        }), \
             patch("crate.api.auth._google_userinfo", return_value={
                 "id": "google-sub-123",
                 "email": "legacy@test.com",
                 "name": "Legacy User",
             }), \
             patch("crate.api.auth.get_user_by_external_identity", return_value=None), \
             patch("crate.api.auth.get_user_by_google_id", return_value=legacy_user), \
             patch("crate.api.auth.upsert_user_external_identity") as mock_upsert, \
             patch("crate.api.auth.update_user_last_login") as mock_last_login, \
             patch("crate.api.auth._create_login_session", return_value=("jwt-token", {"id": "sess-1"})):
            response = asyncio.run(oauth_callback(self._request(), "google", code="code", state="state"))

        assert response.headers["location"] == "cratemusic://oauth/callback?token=jwt-token"
        mock_upsert.assert_called_once()
        mock_last_login.assert_called_once_with(legacy_user["id"])

    def test_google_callback_identity_conflict_returns_409(self):
        from fastapi import HTTPException
        from sqlalchemy.exc import IntegrityError

        from crate.api.auth import oauth_callback

        existing_user = {
            "id": 7,
            "email": "conflict@test.com",
            "role": "user",
            "username": "conflict",
            "name": "Conflict User",
            "google_id": None,
        }

        with patch("crate.api.auth._parse_oauth_state", return_value={
            "provider": "google",
            "return_to": "cratemusic://oauth/callback",
            "mode": "login",
            "verifier": "verifier",
        }), \
             patch("crate.api.auth._google_userinfo", return_value={
                 "id": "google-sub-999",
                 "email": "conflict@test.com",
                 "name": "Conflict User",
             }), \
             patch("crate.api.auth.get_user_by_external_identity", return_value=None), \
             patch("crate.api.auth.get_user_by_google_id", return_value=None), \
             patch("crate.api.auth.get_user_by_email", return_value=existing_user), \
             patch(
                 "crate.api.auth.upsert_user_external_identity",
                 side_effect=IntegrityError(
                     "INSERT INTO user_external_identities ...",
                     {},
                     Exception("duplicate key value violates unique constraint idx_user_external_identities_provider_user_id"),
                 ),
             ):
            with pytest.raises(HTTPException) as exc_info:
                asyncio.run(oauth_callback(self._request(), "google", code="code", state="state"))

        assert exc_info.value.status_code == 409
        assert "already linked" in exc_info.value.detail


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
             patch("crate.api.auth.get_setting", return_value=None), \
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
             patch("crate.api.auth.get_setting", return_value=None), \
             patch("crate.api.auth.verify_password", return_value=False):
            resp = test_app.post("/api/auth/login", json={"email": "test@test.com", "password": "wrong"})
            assert resp.status_code == 401

    def test_login_unknown_email(self, test_app):
        with patch("crate.api.auth.get_user_by_email", return_value=None), \
             patch("crate.api.auth.get_setting", return_value=None):
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

    @patch("crate.auth._get_jwt_secret", return_value="test-secret-key-1234-12345678901234")
    def test_auth_middleware_does_not_touch_session_on_authenticated_reads(self, _mock_secret):
        from crate.api.auth import AuthMiddleware
        from crate.auth import create_jwt

        token = create_jwt(1, "admin@cratemusic.app", "admin", session_id="sess-123")

        app = FastAPI()
        app.add_middleware(AuthMiddleware)

        @app.get("/ping")
        def ping(request: Request):
            return {"user": request.state.user["email"]}

        with patch(
            "crate.api.auth_cache.get_cached_session",
            return_value={"id": "sess-123", "expires_at": datetime.now(timezone.utc) + timedelta(hours=1), "revoked_at": None},
        ), patch(
            "crate.api.auth_cache.get_cached_user",
            return_value={"id": 1, "email": "admin@cratemusic.app", "role": "admin"},
        ), patch("crate.api.auth.touch_session") as mock_touch:
            with TestClient(app) as client:
                client.cookies.set("crate_session", token)
                response = client.get("/ping")

        assert response.status_code == 200
        assert response.json()["user"] == "admin@cratemusic.app"
        mock_touch.assert_not_called()

    @patch("crate.auth._get_jwt_secret", return_value="test-secret-key-1234-12345678901234")
    def test_auth_middleware_accepts_listen_cookie_without_origin_hint(self, _mock_secret):
        from crate.api.auth import AuthMiddleware
        from crate.auth import create_jwt

        token = create_jwt(1, "admin@cratemusic.app", "admin", session_id="sess-123")

        app = FastAPI()
        app.add_middleware(AuthMiddleware)

        @app.get("/asset")
        def asset(request: Request):
            return {"user": request.state.user["email"]}

        with patch(
            "crate.api.auth_cache.get_cached_session",
            return_value={"id": "sess-123", "expires_at": datetime.now(timezone.utc) + timedelta(hours=1), "revoked_at": None},
        ), patch(
            "crate.api.auth_cache.get_cached_user",
            return_value={"id": 1, "email": "admin@cratemusic.app", "role": "admin"},
        ):
            with TestClient(app) as client:
                client.cookies.set("crate_session_listen", token)
                response = client.get("/asset")

        assert response.status_code == 200
        assert response.json()["user"] == "admin@cratemusic.app"


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

    def test_parse_device_details_returns_structured_mobile_client_metadata(self):
        from crate.db.repositories.auth_shared import parse_device_details, parse_device_label

        user_agent = (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 "
            "Mobile/15E148 Safari/604.1"
        )

        details = parse_device_details(user_agent)

        assert details["client_name"] == "Mobile Safari"
        assert details["os_name"] == "iOS"
        assert details["device_brand"] == "Apple"
        assert details["device_model"] == "iPhone"
        assert details["device_type"] == "smartphone"
        assert parse_device_label(user_agent) == "Apple iPhone · iOS 17.4"

    def test_user_presence_counts_only_active_sessions_from_active_devices(self, pg_db):
        from sqlalchemy import text

        from crate.db.queries.auth_presence import get_users_presence
        from crate.db.repositories.auth_sessions import list_sessions
        from crate.db.tx import transaction_scope

        user = pg_db.create_user("presence-auth@test.com")
        now = datetime.now(timezone.utc)
        iphone_ua = (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 "
            "Mobile/15E148 Safari/604.1"
        )
        mac_ua = (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
        )

        pg_db.create_session("iphone-a", user["id"], (now + timedelta(days=7)).isoformat(), user_agent=iphone_ua, last_seen_ip="10.0.0.5")
        pg_db.create_session("iphone-b", user["id"], (now + timedelta(days=7)).isoformat(), user_agent=iphone_ua, last_seen_ip="10.0.0.5")
        pg_db.create_session("desktop-a", user["id"], (now + timedelta(days=7)).isoformat(), user_agent=mac_ua, last_seen_ip="10.0.0.8")
        pg_db.create_session("history-a", user["id"], (now + timedelta(days=7)).isoformat(), user_agent=iphone_ua, last_seen_ip="10.0.0.5")

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE sessions
                    SET last_seen_at = CASE id
                        WHEN 'iphone-a' THEN :active_one
                        WHEN 'iphone-b' THEN :active_two
                        WHEN 'desktop-a' THEN :active_three
                        WHEN 'history-a' THEN :history
                    END
                    WHERE id IN ('iphone-a', 'iphone-b', 'desktop-a', 'history-a')
                    """
                ),
                {
                    "active_one": now - timedelta(seconds=45),
                    "active_two": now - timedelta(seconds=75),
                    "active_three": now - timedelta(seconds=90),
                    "history": now - timedelta(days=12),
                },
            )

        presence = get_users_presence([user["id"]])[user["id"]]
        sessions = list_sessions(user["id"], include_revoked=True)
        session_map = {session["id"]: session for session in sessions}

        assert presence["online_now"] is True
        assert presence["active_sessions"] == 3
        assert presence["active_devices"] == 2
        assert session_map["iphone-a"]["activity_state"] == "active"
        assert session_map["history-a"]["activity_state"] == "history"
        assert session_map["iphone-a"]["display_label"] == "Apple iPhone · iOS 17.4"
        assert session_map["desktop-a"]["client_name"] == "Chrome"

    def test_listen_now_playing_promotes_hidden_listen_session_to_active(self, pg_db):
        from sqlalchemy import text

        from crate.db.queries.auth_presence import get_users_presence
        from crate.db.repositories.auth_sessions import list_sessions
        from crate.db.tx import transaction_scope

        user = pg_db.create_user("presence-listen@test.com")
        now = datetime.now(timezone.utc)
        mac_ua = (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
        )

        pg_db.create_session(
            "admin-active",
            user["id"],
            (now + timedelta(days=7)).isoformat(),
            user_agent=mac_ua,
            last_seen_ip="10.0.0.8",
            app_id="admin-web",
        )
        pg_db.create_session(
            "listen-hidden",
            user["id"],
            (now + timedelta(days=7)).isoformat(),
            user_agent=mac_ua,
            last_seen_ip="10.0.0.8",
            app_id="listen-web",
        )

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE sessions
                    SET last_seen_at = CASE id
                        WHEN 'admin-active' THEN :admin_seen
                        WHEN 'listen-hidden' THEN :listen_seen
                    END
                    WHERE id IN ('admin-active', 'listen-hidden')
                    """
                ),
                {
                    "admin_seen": now - timedelta(seconds=30),
                    "listen_seen": now - timedelta(minutes=10),
                },
            )

        def fake_get_cache(key: str, max_age_seconds: int | None = None) -> dict[str, Any] | None:
            if key == f"now_playing:{user['id']}":
                return {
                    "title": "Mind's A Lie",
                    "artist": "High Vis",
                    "album": "Guided Tour",
                    "heartbeat_at": now.isoformat(),
                    "app_platform": "listen-web",
                }
            return None

        with patch("crate.db.repositories.auth_sessions.get_cache", side_effect=fake_get_cache), patch(
            "crate.db.cache_store.get_cache",
            side_effect=fake_get_cache,
        ):
            presence = get_users_presence([user["id"]])[user["id"]]
            sessions = list_sessions(user["id"], include_revoked=True)

        session_map = {session["id"]: session for session in sessions}

        assert presence["listening_now"] is True
        assert presence["active_sessions"] == 2
        assert presence["active_devices"] == 1
        assert session_map["listen-hidden"]["activity_state"] == "active"
        assert session_map["admin-active"]["activity_state"] == "active"

    def test_admin_can_set_password_for_sso_only_user_and_revoke_sessions(self, real_auth_client, pg_db):
        from crate.auth import verify_password

        now = datetime.now(timezone.utc)
        user = pg_db.create_user("sso-only@test.com", password_hash=None, google_id="google-123")
        pg_db.create_session("target-sess-a", user["id"], now + timedelta(days=7))
        pg_db.create_session("target-sess-b", user["id"], now + timedelta(days=7))

        login = real_auth_client.post(
            "/api/auth/login",
            json={"email": "admin@cratemusic.app", "password": "admin"},
        )
        assert login.status_code == 200
        token = login.json()["token"]

        response = real_auth_client.post(
            f"/api/auth/users/{user['id']}/set-password",
            json={"new_password": "BetterPass123!", "revoke_all_sessions": True},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        assert response.json()["ok"] is True
        assert response.json()["revoked"] == 2

        updated = pg_db.get_user_by_id(user["id"])
        assert updated is not None
        assert verify_password("BetterPass123!", updated["password_hash"])

        sessions = pg_db.list_sessions(user["id"], include_revoked=True)
        assert all(session["revoked_at"] is not None for session in sessions)


class TestLogout:
    def test_logout_clears_cookie(self, test_app):
        resp = test_app.post("/api/auth/logout")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
