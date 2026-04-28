def test_build_live_activity_payload_prefers_worker_runtime_state(monkeypatch):
    from crate.db import ops_snapshot_builders as ops_snapshot
    from crate.db import ops_snapshot_activity

    runtime_state = {
        "engine": "dramatiq",
        "running_count": 2,
        "pending_count": 3,
        "running_tasks": [{"id": "r1", "type": "scan", "status": "running", "pool": "default", "progress": {}, "created_at": None, "started_at": None, "updated_at": None}],
        "pending_tasks": [{"id": "p1", "type": "library_sync", "status": "pending", "pool": "heavy", "progress": {}, "created_at": None, "started_at": None, "updated_at": None}],
        "recent_tasks": [{"id": "r1", "type": "scan", "status": "running", "updated_at": None}],
        "worker_slots": {"max": 6, "active": 2},
        "scan": {"running": True, "progress": {"phase": "scan"}},
        "systems": {"postgres": True, "watcher": True},
    }

    monkeypatch.setattr(ops_snapshot_activity, "get_worker_live_state", lambda max_age_seconds=30: runtime_state)
    monkeypatch.setattr(ops_snapshot_activity, "list_tasks", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("list_tasks should not be called")))
    monkeypatch.setattr(ops_snapshot_activity, "get_latest_scan", lambda: None)
    monkeypatch.setattr(ops_snapshot_activity, "count_import_queue_items", lambda status="pending": 0)

    live = ops_snapshot.build_live_activity_payload()
    recent = ops_snapshot.build_recent_activity_payload()
    status = ops_snapshot.build_public_status_payload(live)

    assert live["engine"] == "dramatiq"
    assert len(live["running_tasks"]) == 1
    assert len(live["pending_tasks"]) == 1
    assert recent["tasks"] == [
        {
            "id": "r1",
            "type": "scan",
            "status": "running",
            "created_at": None,
            "updated_at": None,
        }
    ]
    assert status["scanning"] is True
    assert status["progress"] == {"phase": "scan"}
