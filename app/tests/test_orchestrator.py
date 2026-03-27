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
        # Patching crate.db.update_task intercepts the `from crate.db import update_task` inside the method
        with patch("crate.orchestrator.list_tasks", return_value=orphaned_tasks), \
             patch("crate.db.update_task") as mock_update:
            orch._cleanup_orphaned_tasks()

        assert mock_update.call_count == 2
        mock_update.assert_any_call("abc123", status="failed", error="Orphaned: orchestrator restarted")
        mock_update.assert_any_call("def456", status="failed", error="Orphaned: orchestrator restarted")

    def test_handles_empty_orphaned_list(self):
        from crate.orchestrator import Orchestrator
        config = {"library_path": "/tmp/fake"}
        orch = Orchestrator(config)

        with patch("crate.orchestrator.list_tasks", return_value=[]), \
             patch("crate.db.update_task") as mock_update:
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

        def fake_spawn():
            mock_new_proc = MagicMock()
            mock_new_proc.is_alive.return_value = True
            mock_new_proc.pid = 9999
            new_wp = WorkerProcess(mock_new_proc, worker_id=3)
            orch.workers.append(new_wp)
            return new_wp

        with patch.object(orch, "_get_min_workers", return_value=2), \
             patch.object(orch, "_spawn_worker", side_effect=fake_spawn) as mock_spawn:
            orch._health_check()

        # Dead worker should be removed, new one spawned to meet min_workers
        assert len(orch.workers) == 2  # alive_wp + newly spawned
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


class TestShutdownWorkers:
    def test_sends_sigterm_to_workers(self):
        from crate.orchestrator import Orchestrator, WorkerProcess

        config = {"library_path": "/tmp/fake"}
        orch = Orchestrator(config)

        mock_proc = MagicMock()
        mock_proc.is_alive.return_value = True
        mock_proc.pid = 42
        wp = WorkerProcess(mock_proc, worker_id=1)
        orch.workers = [wp]

        with patch("os.kill") as mock_kill:
            orch._shutdown_workers()

        mock_kill.assert_called_once()
        mock_proc.join.assert_called_once()
