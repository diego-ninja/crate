from __future__ import annotations


def test_resource_governor_defers_governed_task_when_load_is_high(monkeypatch):
    from crate import resource_governor as governor

    monkeypatch.setenv("CRATE_RESOURCE_GOVERNOR_ENABLED", "true")
    monkeypatch.setenv("CRATE_MAINTENANCE_WINDOW_ENABLED", "false")
    monkeypatch.setenv("CRATE_RESOURCE_MAX_LOAD_RATIO", "0.50")
    monkeypatch.setattr(
        governor,
        "build_snapshot",
        lambda include_playback=True: governor.ResourceSnapshot(
            cpu_count=4,
            load_1m=4.0,
            load_ratio=1.0,
            iowait_percent=0.0,
            swap_used_percent=0.0,
            active_users=0,
            active_streams=0,
        ),
    )

    decision = governor.should_defer_task("library_sync")

    assert decision.allowed is False
    assert "load 1.00>0.50" in decision.reason


def test_resource_governor_allows_non_governed_tasks_without_sampling(monkeypatch):
    from crate import resource_governor as governor

    monkeypatch.setattr(
        governor,
        "build_snapshot",
        lambda include_playback=True: (_ for _ in ()).throw(AssertionError("should not sample")),
    )

    decision = governor.should_defer_task("tidal_download")

    assert decision.allowed is True


def test_resource_governor_can_be_bypassed_per_task(monkeypatch):
    from crate import resource_governor as governor

    monkeypatch.setattr(
        governor,
        "build_snapshot",
        lambda include_playback=True: governor.ResourceSnapshot(
            cpu_count=1,
            load_1m=10.0,
            load_ratio=10.0,
        ),
    )

    decision = governor.should_defer_task("library_sync", {"ignore_resource_governor": True})

    assert decision.allowed is True


def test_maintenance_window_defers_full_batch_work_outside_window(monkeypatch):
    from crate import resource_governor as governor

    monkeypatch.setenv("CRATE_MAINTENANCE_WINDOW_ENABLED", "true")
    monkeypatch.setenv("CRATE_MAINTENANCE_WINDOW_START", "02:00")
    monkeypatch.setenv("CRATE_MAINTENANCE_WINDOW_END", "07:00")
    monkeypatch.setattr(governor, "_local_minutes_now", lambda: 12 * 60)
    monkeypatch.setattr(
        governor,
        "build_snapshot",
        lambda include_playback=True: (_ for _ in ()).throw(AssertionError("window should short-circuit")),
    )

    decision = governor.should_defer_task("library_sync", {})

    assert decision.allowed is False
    assert decision.reason == "outside maintenance window 02:00-07:00"
    assert decision.window["in_window"] is False


def test_maintenance_window_allows_scoped_sync_outside_window(monkeypatch, tmp_path):
    from crate import resource_governor as governor

    monkeypatch.setenv("CRATE_MAINTENANCE_WINDOW_ENABLED", "true")
    monkeypatch.setattr(governor, "_local_minutes_now", lambda: 12 * 60)
    monkeypatch.setattr(
        governor,
        "build_snapshot",
        lambda include_playback=True: governor.ResourceSnapshot(
            cpu_count=4,
            load_1m=0.5,
            load_ratio=0.125,
            iowait_percent=0.0,
            swap_used_percent=0.0,
            active_users=0,
            active_streams=0,
        ),
    )

    decision = governor.should_defer_task("library_sync", {"album_dir": str(tmp_path / "Album")})

    assert decision.allowed is True


def test_maintenance_window_defers_large_fingerprint_backfill(monkeypatch):
    from crate import resource_governor as governor

    monkeypatch.setenv("CRATE_MAINTENANCE_WINDOW_ENABLED", "true")
    monkeypatch.setenv("CRATE_MAINTENANCE_WINDOW_FINGERPRINT_LIMIT", "1000")
    monkeypatch.setattr(governor, "_local_minutes_now", lambda: 12 * 60)

    decision = governor.should_defer_task("backfill_track_audio_fingerprints", {"limit": 5000})

    assert decision.allowed is False
    assert "maintenance window" in decision.reason


def test_record_decision_emits_deferral_metrics(monkeypatch):
    from crate import resource_governor as governor

    counters: list[tuple[str, dict | None]] = []
    records: list[tuple[str, float, dict | None]] = []

    monkeypatch.setattr("crate.db.cache_store.set_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.metrics.record_counter", lambda name, tags=None: counters.append((name, tags)))
    monkeypatch.setattr("crate.metrics.record", lambda name, value, tags=None: records.append((name, value, tags)))

    decision = governor.ResourceDecision(
        allowed=False,
        reason="outside maintenance window 02:00-07:00",
        defer_seconds=600,
        snapshot=governor.ResourceSnapshot(
            cpu_count=4,
            load_1m=2.0,
            load_ratio=0.5,
            iowait_percent=3.0,
            swap_used_percent=0.0,
        ),
    )

    governor.record_decision(decision, task_type="library_pipeline", source="scheduler")

    assert counters == [
        (
            "worker.resource.deferred",
            {"task_type": "library_pipeline", "source": "scheduler", "reason": "maintenance_window"},
        )
    ]
    assert ("worker.resource.defer_seconds", 600.0, counters[0][1]) in records
    assert ("worker.resource.load_ratio", 0.5, counters[0][1]) in records
