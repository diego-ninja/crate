"""Tests for the process-based worker orchestrator."""

from unittest.mock import patch, MagicMock, PropertyMock
import multiprocessing
import time

import pytest


class TestWorkerProcess:
    def test_tracks_uptime(self):
        from crate.orchestrator import WorkerProcess
        mock_proc = MagicMock()
        mock_proc.pid = 12345
        mock_proc.is_alive.return_value = True

        wp = WorkerProcess(mock_proc, worker_id=1)
        assert wp.worker_id == 1
        assert wp.pid == 12345
        assert wp.is_alive
        assert wp.uptime >= 0


class TestOrchestratorInit:
    def test_initial_state(self):
        from crate.orchestrator import Orchestrator
        config = {"library_path": "/tmp/fake"}
        orch = Orchestrator(config)

        assert orch.workers == []
        assert orch._shutdown is False
        assert orch._next_worker_id == 1


class TestCleanupOrphanedTasks:
    def test_marks_running_tasks_as_failed(self):
        """Tasks left in 'running' should be marked as failed on startup."""
        from crate.orchestrator import Orchestrator

        config = {"library_path": "/tmp/fake"}
        orch = Orchestrator(config)

        orphaned_tasks = [
            {"id": "abc123", "type": "process_new_content"},
            {"id": "def456", "type": "enrich_artist"},
        ]

        # _cleanup_orphaned_tasks uses module-level list_tasks and local `from crate.db import update_task`
        with patch("crate.orchestrator.list_tasks", return_value=orphaned_tasks), \
             patch("crate.db.tasks.update_task") as mock_update:
            orch._cleanup_orphaned_tasks()

        assert mock_update.call_count == 2
        mock_update.assert_any_call("abc123", status="failed", error="Orphaned: orchestrator restarted")
        mock_update.assert_any_call("def456", status="failed", error="Orphaned: orchestrator restarted")

    def test_handles_empty_orphaned_list(self):
        from crate.orchestrator import Orchestrator
        config = {"library_path": "/tmp/fake"}
        orch = Orchestrator(config)

        with patch("crate.orchestrator.list_tasks", return_value=[]), \
             patch("crate.db.tasks.update_task") as mock_update:
            orch._cleanup_orphaned_tasks()

        mock_update.assert_not_called()

    def test_handles_db_error_gracefully(self):
        """If DB is down, cleanup should not crash the orchestrator."""
        from crate.orchestrator import Orchestrator
        config = {"library_path": "/tmp/fake"}
        orch = Orchestrator(config)

        with patch("crate.orchestrator.list_tasks", side_effect=Exception("DB down")):
            # Should not raise
            orch._cleanup_orphaned_tasks()


class TestHealthCheck:
    def test_restarts_dead_workers(self):
        from crate.orchestrator import Orchestrator, WorkerProcess

        config = {"library_path": "/tmp/fake"}
        orch = Orchestrator(config)

        # Create mock workers — one alive, one dead
        alive_proc = MagicMock()
        alive_proc.is_alive.return_value = True
        alive_wp = WorkerProcess(alive_proc, worker_id=1)

        dead_proc = MagicMock()
        dead_proc.is_alive.return_value = False
        dead_proc.exitcode = 1
        dead_wp = WorkerProcess(dead_proc, worker_id=2)

        orch.workers = [alive_wp, dead_wp]

        with patch.object(orch, "_get_min_workers", return_value=2), \
             patch.object(orch, "_spawn_worker") as mock_spawn:
            orch._health_check()

        # Dead worker should be removed, new one spawned to meet min_workers
        assert len(orch.workers) == 1
        assert orch.workers[0].worker_id == 1
        mock_spawn.assert_called_once()


class TestAutoscale:
    def test_scales_up_when_queue_deep(self):
        from crate.orchestrator import Orchestrator, WorkerProcess

        config = {"library_path": "/tmp/fake"}
        orch = Orchestrator(config)

        # 2 current workers
        for i in range(2):
            mock_proc = MagicMock()
            mock_proc.is_alive.return_value = True
            orch.workers.append(WorkerProcess(mock_proc, worker_id=i + 1))

        # 5 pending tasks (more than current workers)
        pending = [{"id": f"t{i}"} for i in range(5)]
        running = [{"id": "r1"}]

        with patch.object(orch, "_get_min_workers", return_value=2), \
             patch.object(orch, "_get_max_workers", return_value=5), \
             patch("crate.orchestrator.list_tasks", side_effect=[pending, running]), \
             patch.object(orch, "_spawn_worker") as mock_spawn:
            orch._autoscale()

        # Should spawn 1 additional worker
        mock_spawn.assert_called_once()

    def test_does_not_exceed_max_workers(self):
        from crate.orchestrator import Orchestrator, WorkerProcess

        config = {"library_path": "/tmp/fake"}
        orch = Orchestrator(config)

        # Already at max (3 workers, max=3)
        for i in range(3):
            mock_proc = MagicMock()
            mock_proc.is_alive.return_value = True
            orch.workers.append(WorkerProcess(mock_proc, worker_id=i + 1))

        pending = [{"id": f"t{i}"} for i in range(10)]

        with patch.object(orch, "_get_min_workers", return_value=2), \
             patch.object(orch, "_get_max_workers", return_value=3), \
             patch("crate.orchestrator.list_tasks", side_effect=[pending, []]), \
             patch.object(orch, "_spawn_worker") as mock_spawn:
            orch._autoscale()

        mock_spawn.assert_not_called()


class TestGetStatus:
    def test_status_includes_worker_info(self):
        from crate.orchestrator import Orchestrator, WorkerProcess

        config = {"library_path": "/tmp/fake"}
        orch = Orchestrator(config)

        mock_proc = MagicMock()
        mock_proc.is_alive.return_value = True
        mock_proc.pid = 999
        wp = WorkerProcess(mock_proc, worker_id=1)
        wp.pid = 999
        orch.workers = [wp]

        with patch.object(orch, "_get_min_workers", return_value=2), \
             patch.object(orch, "_get_max_workers", return_value=5):
            status = orch.get_status()

        assert status["total_workers"] == 1
        assert status["alive_workers"] == 1
        assert status["min_workers"] == 2
        assert status["max_workers"] == 5
        assert len(status["workers"]) == 1
        assert status["workers"][0]["pid"] == 999
        assert status["workers"][0]["alive"] is True


class TestWorkerProcessEntry:
    """Test the _worker_process_entry function logic (without actually spawning processes)."""

    def test_recycles_after_max_tasks(self):
        """Worker should exit after max_tasks (simulated with max_tasks=1)."""
        from crate.orchestrator import _worker_process_entry

        fake_task = {
            "id": "t1", "type": "test_task", "params": {},
            "status": "running", "created_at": "2024-01-01",
        }

        mock_handler = MagicMock(return_value={"ok": True})

        # _worker_process_entry does local imports from crate.worker and crate.db,
        # so we patch those modules directly.
        with patch("crate.db.core._reset_pool"), \
             patch("crate.utils.init_musicbrainz"), \
             patch("crate.worker.TASK_HANDLERS", {"test_task": mock_handler}), \
             patch("crate.worker._is_cancelled", return_value=False), \
             patch("crate.db.tasks.claim_next_task", side_effect=[fake_task, None]), \
             patch("crate.db.tasks.update_task") as mock_update, \
             patch("crate.db.cache.get_setting", return_value="5"), \
             patch("crate.db.tasks.get_task"), \
             patch("resource.getrusage") as mock_rusage:
            mock_rusage.return_value = MagicMock(ru_maxrss=100 * 1024 * 1024)  # 100MB

            # max_tasks=1 — should process one task then exit
            _worker_process_entry(config={}, worker_id=1, max_tasks=1, max_rss_mb=1500)

        mock_handler.assert_called_once()
