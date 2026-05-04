from crate.worker_handlers.management import _handle_repair


def test_handle_repair_revalidates_applied_checks(monkeypatch):
    emitted: list[tuple[str, str, dict]] = []
    domain_events: list[tuple[str, dict, str, str]] = []
    resolved_issue_ids: list[int] = []

    class FakeRepair:
        def __init__(self, config):
            self.config = config

        def repair(self, report, dry_run=True, auto_only=True, task_id=None, progress_callback=None, event_callback=None):
            assert dry_run is False
            assert auto_only is False
            if event_callback:
                event_callback(
                    {
                        "event_type": "item",
                        "level": "info",
                        "check_type": "duplicate_albums",
                        "outcome": "applied",
                        "item_key": "issue:7",
                        "target": "Birds In Row/UGLY",
                        "action": "delete_loose",
                        "message": "Applied delete loose on Birds In Row/UGLY",
                    }
                )
            return {
                "actions": [{"action": "delete_loose", "applied": True, "details": {}}],
                "item_results": [
                    {
                        "check_type": "duplicate_albums",
                        "outcome": "applied",
                    }
                ],
                "summary": {"applied": 1, "skipped": 0, "failed": 0, "unsupported": 0},
                "fs_changed": False,
                "db_changed": True,
                "resolved_ids": [7],
                "unsupported_checks": [],
            }

    class FakeHealthCheck:
        def __init__(self, config):
            self.config = config

        def run_selected(self, check_types, *, progress_callback=None, persist=True):
            assert set(check_types) == {"duplicate_albums"}
            assert persist is True
            if progress_callback:
                progress_callback({"check": "duplicate_albums", "done": 0, "total": 1})
            return {
                "issues": [],
                "summary": {},
                "check_count": 1,
                "duration_ms": 12,
                "scanned_at": "2026-04-30T10:00:00+00:00",
            }

    monkeypatch.setattr("crate.repair.LibraryRepair", FakeRepair)
    monkeypatch.setattr("crate.health_check.LibraryHealthCheck", FakeHealthCheck)
    monkeypatch.setattr("crate.worker_handlers.management.emit_progress", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.management.emit_task_event", lambda task_id, event_type, payload: emitted.append((task_id, event_type, payload)))
    monkeypatch.setattr("crate.db.domain_events.append_domain_event", lambda event_type, payload, scope=None, subject_key=None: domain_events.append((event_type, payload, scope, subject_key)))
    monkeypatch.setattr("crate.worker_handlers.management.resolve_issue", lambda issue_id: resolved_issue_ids.append(issue_id))
    monkeypatch.setattr("crate.db.admin_health_surface.publish_health_surface_signal", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.management._mark_processing", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.management._unmark_processing", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.management.start_scan", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.management.get_open_issues", lambda limit=10000: [])

    result = _handle_repair(
        "repair-task-1",
        {
            "dry_run": False,
            "auto_only": False,
            "issues": [
                {
                    "id": 7,
                    "check": "duplicate_albums",
                    "details": {"artist": "Birds In Row", "album": "UGLY"},
                }
            ],
        },
        {"library_path": "/tmp/fake", "audio_extensions": [".flac"]},
    )

    assert resolved_issue_ids == [7]
    assert result["revalidated_checks"] == ["duplicate_albums"]
    assert result["revalidation"] == {"issue_count": 0, "summary": {}, "duration_ms": 12}
    assert "open after revalidation" in result["message"]
    assert any("Revalidating 1 repaired check type" in payload.get("message", "") for _, _, payload in emitted)
    assert any(event_type == "library.repair.completed" for event_type, _, _, _ in domain_events)
