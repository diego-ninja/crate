"""Tests for atomic task dedup (create_task_dedup).

These tests require PostgreSQL because dedup relies on SQL atomicity
(INSERT ... WHERE NOT EXISTS with params_json::text cast).
"""

import json

import pytest


class TestCreateTaskDedup:
    def test_creates_task_when_none_exists(self, pg_db):
        task_id = pg_db.create_task_dedup("enrich_artist", {"artist": "Converge"})
        assert task_id is not None
        assert len(task_id) == 12

        task = pg_db.get_task(task_id)
        assert task is not None
        assert task["type"] == "enrich_artist"
        assert task["status"] == "pending"
        assert task["params"]["artist"] == "Converge"

    def test_returns_none_for_duplicate_pending(self, pg_db):
        """Same type+params while first is still pending should be deduplicated."""
        params = {"artist": "Deftones"}
        first = pg_db.create_task_dedup("enrich_artist", params)
        assert first is not None

        second = pg_db.create_task_dedup("enrich_artist", params)
        assert second is None

    def test_returns_none_for_duplicate_running(self, pg_db):
        """Same type+params while first is running should also be deduplicated."""
        params = {"artist": "Mogwai"}
        task_id = pg_db.create_task_dedup("process_new_content", params)
        assert task_id is not None

        # Simulate worker claiming it
        pg_db.update_task(task_id, status="running")

        # Try to create another one with same params
        second = pg_db.create_task_dedup("process_new_content", params)
        assert second is None

    def test_allows_different_types(self, pg_db):
        """Different task types with same params should both be created."""
        params = {"artist": "ISIS"}
        first = pg_db.create_task_dedup("enrich_artist", params)
        second = pg_db.create_task_dedup("process_new_content", params)
        assert first is not None
        assert second is not None
        assert first != second

    def test_allows_different_params(self, pg_db):
        """Same type with different params should both be created."""
        first = pg_db.create_task_dedup("enrich_artist", {"artist": "Pelican"})
        second = pg_db.create_task_dedup("enrich_artist", {"artist": "Rosetta"})
        assert first is not None
        assert second is not None
        assert first != second

    def test_allows_after_completion(self, pg_db):
        """After a task completes, a new one with same params should be allowed."""
        params = {"artist": "Neurosis"}
        first = pg_db.create_task_dedup("enrich_artist", params)
        assert first is not None

        # Mark as completed
        pg_db.update_task(first, status="completed", result={"ok": True})

        # Should now allow a new task
        second = pg_db.create_task_dedup("enrich_artist", params)
        assert second is not None
        assert second != first

    def test_allows_after_failure(self, pg_db):
        """After a task fails, a new one with same params should be allowed."""
        params = {"artist": "Botch"}
        first = pg_db.create_task_dedup("enrich_artist", params)
        pg_db.update_task(first, status="failed", error="timeout")

        second = pg_db.create_task_dedup("enrich_artist", params)
        assert second is not None

    def test_params_key_order_independent(self, pg_db):
        """Params differing only in key order should be treated as duplicates
        (create_task_dedup uses sort_keys=True)."""
        first = pg_db.create_task_dedup("enrich_artist", {"a": 1, "b": 2})
        second = pg_db.create_task_dedup("enrich_artist", {"b": 2, "a": 1})
        assert first is not None
        assert second is None

    def test_none_params_works(self, pg_db):
        """Passing None as params should work (defaults to empty dict)."""
        first = pg_db.create_task_dedup("health_check")
        assert first is not None

        second = pg_db.create_task_dedup("health_check")
        assert second is None
