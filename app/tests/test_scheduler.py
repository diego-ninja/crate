"""Tests for crate.scheduler — schedule logic."""

from datetime import datetime, timezone, timedelta
from unittest.mock import patch


class TestShouldRun:
    def test_should_run_no_previous_run(self):
        schedules = {"library_sync": 1800}
        with patch("crate.scheduler.get_setting", return_value=None), \
             patch("crate.scheduler.list_tasks", return_value=[]):
            from crate.scheduler import should_run
            assert should_run("library_sync", schedules) is True

    def test_should_not_run_interval_not_elapsed(self):
        schedules = {"library_sync": 1800}
        recent = datetime.now(timezone.utc).isoformat()
        with patch("crate.scheduler.get_setting", return_value=recent), \
             patch("crate.scheduler.list_tasks", return_value=[]):
            from crate.scheduler import should_run
            assert should_run("library_sync", schedules) is False

    def test_should_run_interval_elapsed(self):
        schedules = {"library_sync": 1800}
        old = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        with patch("crate.scheduler.get_setting", return_value=old), \
             patch("crate.scheduler.list_tasks", return_value=[]):
            from crate.scheduler import should_run
            assert should_run("library_sync", schedules) is True

    def test_should_not_run_disabled(self):
        schedules = {"library_sync": 0}
        from crate.scheduler import should_run
        assert should_run("library_sync", schedules) is False

    def test_should_not_run_negative_interval(self):
        schedules = {"library_sync": -1}
        from crate.scheduler import should_run
        assert should_run("library_sync", schedules) is False

    def test_should_not_run_task_pending(self):
        schedules = {"library_sync": 1800}
        old = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        with patch("crate.scheduler.get_setting", return_value=old), \
             patch("crate.scheduler.list_tasks", side_effect=[
                 [{"id": "pending_task"}],  # pending tasks
                 [],  # running tasks
             ]):
            from crate.scheduler import should_run
            assert should_run("library_sync", schedules) is False

    def test_should_not_run_task_running(self):
        schedules = {"library_sync": 1800}
        old = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        with patch("crate.scheduler.get_setting", return_value=old), \
             patch("crate.scheduler.list_tasks", side_effect=[
                 [],  # pending
                 [{"id": "running_task"}],  # running
             ]):
            from crate.scheduler import should_run
            assert should_run("library_sync", schedules) is False

    def test_should_not_run_unknown_task(self):
        schedules = {"library_sync": 1800}
        from crate.scheduler import should_run
        assert should_run("nonexistent_task", schedules) is False


class TestGetSetSchedules:
    def test_get_schedules_default(self):
        with patch("crate.scheduler.get_setting", return_value=None):
            from crate.scheduler import get_schedules, DEFAULT_SCHEDULES
            schedules = get_schedules()
            assert schedules == DEFAULT_SCHEDULES

    def test_get_schedules_custom(self):
        import json
        custom = {"library_pipeline": 3600, "enrich_artists": 0}
        with patch("crate.scheduler.get_setting", return_value=json.dumps(custom)), \
             patch("crate.scheduler.set_setting"):
            from crate.scheduler import get_schedules
            schedules = get_schedules()
            assert schedules["library_pipeline"] == 3600
            assert schedules["enrich_artists"] == 0

    def test_set_schedules(self):
        with patch("crate.scheduler.set_setting") as mock_set:
            from crate.scheduler import set_schedules
            set_schedules({"library_sync": 900})
            mock_set.assert_called_once()
            args = mock_set.call_args[0]
            assert args[0] == "schedules"


class TestMarkRun:
    def test_mark_run(self):
        with patch("crate.scheduler.set_setting") as mock_set:
            from crate.scheduler import mark_run
            mark_run("library_sync")
            mock_set.assert_called_once()
            args = mock_set.call_args[0]
            assert args[0] == "schedule:last_run:library_sync"
            # Should be a valid ISO datetime
            datetime.fromisoformat(args[1])
