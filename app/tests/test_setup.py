"""Tests for the setup wizard API."""

from unittest.mock import patch, MagicMock

import pytest


class TestSetupStatus:
    def test_needs_setup_when_no_users(self, test_app):
        mock_cur = MagicMock()
        mock_cur.fetchone.return_value = {"cnt": 0}

        with patch("crate.api.setup.get_db_ctx") as mock_ctx:
            mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_cur)
            mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
            resp = test_app.get("/api/setup/status")

        assert resp.status_code == 200
        assert resp.json()["needs_setup"] is True

    def test_setup_complete_when_users_exist(self, test_app):
        mock_cur = MagicMock()
        mock_cur.fetchone.return_value = {"cnt": 3}

        with patch("crate.api.setup.get_db_ctx") as mock_ctx:
            mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_cur)
            mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
            resp = test_app.get("/api/setup/status")

        assert resp.status_code == 200
        assert resp.json()["needs_setup"] is False


class TestSetupAdmin:
    def test_create_admin(self, test_app):
        mock_cur = MagicMock()
        mock_cur.fetchone.return_value = {"cnt": 0}

        with patch("crate.api.setup.get_db_ctx") as mock_ctx, \
             patch("crate.db.create_user", return_value=42) as mock_create:
            mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_cur)
            mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
            resp = test_app.post("/api/setup/admin", json={
                "email": "admin@test.com",
                "password": "secret123",
                "name": "Admin",
            })

        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "admin@test.com"
        assert data["id"] == 42
        mock_create.assert_called_once()

    def test_cannot_create_when_users_exist(self, test_app):
        """After setup is complete, POST /setup/admin should be rejected."""
        mock_cur = MagicMock()
        mock_cur.fetchone.return_value = {"cnt": 1}

        with patch("crate.api.setup.get_db_ctx") as mock_ctx:
            mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_cur)
            mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
            resp = test_app.post("/api/setup/admin", json={
                "email": "hacker@evil.com",
                "password": "pw",
            })

        assert resp.status_code == 403


class TestSetupScan:
    def test_scan_requires_admin_after_setup(self, test_app):
        """POST /setup/scan should require admin and fail if setup not done."""
        mock_cur = MagicMock()
        mock_cur.fetchone.return_value = {"cnt": 0}  # No users = setup needed

        with patch("crate.api.setup.get_db_ctx") as mock_ctx:
            mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_cur)
            mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
            resp = test_app.post("/api/setup/scan")

        assert resp.status_code == 400  # "Create admin first"

    def test_scan_triggers_library_pipeline(self, test_app):
        """After setup, scan should create a library_pipeline task."""
        mock_cur = MagicMock()
        mock_cur.fetchone.return_value = {"cnt": 1}  # Users exist

        with patch("crate.api.setup.get_db_ctx") as mock_ctx, \
             patch("crate.api.setup.create_task", return_value="task-123") as mock_task:
            mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_cur)
            mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
            resp = test_app.post("/api/setup/scan")

        assert resp.status_code == 200
        assert resp.json()["task_id"] == "task-123"
        mock_task.assert_called_once_with("library_pipeline")
