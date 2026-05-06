def test_process_domain_events_refreshes_ops_and_home(monkeypatch):
    from crate import projector

    calls = {"ops": [], "home": [], "processed": []}

    monkeypatch.setattr(
        projector,
        "list_domain_events",
        lambda limit, unprocessed_only=True: [
            {
                "id": "1682349000000-0",
                "event_type": "track.analysis.updated",
                "scope": "pipeline:analysis",
                "subject_key": "42",
                "payload_json": {"track_id": 42},
            },
            {
                "id": "1682349000001-0",
                "event_type": "ui.invalidate",
                "scope": "ui.invalidate",
                "subject_key": "home:user:7",
                "payload_json": {"scope": "home:user:7"},
            },
        ],
    )
    monkeypatch.setattr(projector, "get_cached_ops_snapshot", lambda fresh=False: calls["ops"].append(fresh) or {"status": {}})
    monkeypatch.setattr(projector, "get_cached_home_discovery", lambda user_id, fresh=False: calls["home"].append((user_id, fresh)) or {})
    monkeypatch.setattr(projector, "mark_domain_events_processed", lambda event_ids: calls["processed"].append(event_ids))

    result = projector.process_domain_events(limit=50)

    assert result == {"processed": 2, "ops_refreshes": 1, "home_refreshes": 1}
    assert calls["ops"] == [True]
    assert calls["home"] == [(7, True)]
    assert calls["processed"] == [["1682349000000-0", "1682349000001-0"]]


def test_process_domain_events_noops_when_empty(monkeypatch):
    from crate import projector

    monkeypatch.setattr(projector, "list_domain_events", lambda limit, unprocessed_only=True: [])

    result = projector.process_domain_events(limit=10)

    assert result == {"processed": 0, "ops_refreshes": 0, "home_refreshes": 0}


def test_warm_recent_home_discovery_snapshots_refreshes_recent_users(monkeypatch):
    from crate import projector

    calls = []

    monkeypatch.setattr(projector, "list_recent_home_user_ids", lambda window_minutes=30, limit=10: [7, 9])
    monkeypatch.setattr(projector, "get_cached_home_discovery", lambda user_id, fresh=False: calls.append((user_id, fresh)) or {})

    warmed = projector.warm_recent_home_discovery_snapshots()

    assert warmed == 2
    assert calls == [(7, True), (9, True)]


def test_process_domain_events_refreshes_home_for_semantic_user_event(monkeypatch):
    from crate import projector

    calls = {"ops": [], "home": [], "processed": []}

    monkeypatch.setattr(
        projector,
        "list_domain_events",
        lambda limit, unprocessed_only=True: [
            {
                "id": "1682349000010-0",
                "event_type": "user.likes.changed",
                "scope": "user",
                "subject_key": "3",
                "payload_json": {"user_id": 3, "action": "like", "track_id": 99},
            },
        ],
    )
    monkeypatch.setattr(projector, "get_cached_ops_snapshot", lambda fresh=False: calls["ops"].append(fresh) or {"status": {}})
    monkeypatch.setattr(projector, "get_cached_home_discovery", lambda user_id, fresh=False: calls["home"].append((user_id, fresh)) or {})
    monkeypatch.setattr(projector, "mark_domain_events_processed", lambda event_ids: calls["processed"].append(event_ids))

    result = projector.process_domain_events(limit=50)

    assert result == {"processed": 1, "ops_refreshes": 0, "home_refreshes": 1}
    assert calls["ops"] == []
    assert calls["home"] == [(3, True)]
    assert calls["processed"] == [["1682349000010-0"]]


def test_process_domain_events_refreshes_home_for_play_event_and_aggregate_update(monkeypatch):
    from crate import projector

    calls = {"ops": [], "home": [], "processed": []}

    monkeypatch.setattr(
        projector,
        "list_domain_events",
        lambda limit, unprocessed_only=True: [
            {
                "id": "1682349000011-0",
                "event_type": "user.play_event.recorded",
                "scope": "user",
                "subject_key": "3",
                "payload_json": {"user_id": 3, "event_id": 77},
            },
            {
                "id": "1682349000012-0",
                "event_type": "user.listening_aggregates.updated",
                "scope": "user",
                "subject_key": "3",
                "payload_json": {"user_id": 3},
            },
        ],
    )
    monkeypatch.setattr(projector, "get_cached_ops_snapshot", lambda fresh=False: calls["ops"].append(fresh) or {"status": {}})
    monkeypatch.setattr(projector, "get_cached_home_discovery", lambda user_id, fresh=False: calls["home"].append((user_id, fresh)) or {})
    monkeypatch.setattr(projector, "mark_domain_events_processed", lambda event_ids: calls["processed"].append(event_ids))

    result = projector.process_domain_events(limit=50)

    assert result == {"processed": 2, "ops_refreshes": 0, "home_refreshes": 1}
    assert calls["ops"] == []
    assert calls["home"] == [(3, True)]
    assert calls["processed"] == [["1682349000011-0", "1682349000012-0"]]


def test_process_domain_events_does_not_refresh_ops_for_home_only_invalidation(monkeypatch):
    from crate import projector

    calls = {"ops": [], "home": [], "processed": []}

    monkeypatch.setattr(
        projector,
        "list_domain_events",
        lambda limit, unprocessed_only=True: [
            {
                "id": "1682349000020-0",
                "event_type": "ui.invalidate",
                "scope": "ui.invalidate",
                "subject_key": "home:user:7",
                "payload_json": {"scope": "home:user:7"},
            },
        ],
    )
    monkeypatch.setattr(projector, "get_cached_ops_snapshot", lambda fresh=False: calls["ops"].append(fresh) or {"status": {}})
    monkeypatch.setattr(projector, "get_cached_home_discovery", lambda user_id, fresh=False: calls["home"].append((user_id, fresh)) or {})
    monkeypatch.setattr(projector, "mark_domain_events_processed", lambda event_ids: calls["processed"].append(event_ids))

    result = projector.process_domain_events(limit=50)

    assert result == {"processed": 1, "ops_refreshes": 0, "home_refreshes": 1}
    assert calls["ops"] == []
    assert calls["home"] == [(7, True)]
    assert calls["processed"] == [["1682349000020-0"]]


def test_process_domain_events_refreshes_ops_for_ops_relevant_invalidation(monkeypatch):
    from crate import projector

    calls = {"ops": [], "home": [], "processed": []}

    monkeypatch.setattr(
        projector,
        "list_domain_events",
        lambda limit, unprocessed_only=True: [
            {
                "id": "1682349000021-0",
                "event_type": "ui.invalidate",
                "scope": "ui.invalidate",
                "subject_key": "playlist:42",
                "payload_json": {"scope": "playlist:42"},
            },
        ],
    )
    monkeypatch.setattr(projector, "get_cached_ops_snapshot", lambda fresh=False: calls["ops"].append(fresh) or {"status": {}})
    monkeypatch.setattr(projector, "get_cached_home_discovery", lambda user_id, fresh=False: calls["home"].append((user_id, fresh)) or {})
    monkeypatch.setattr(projector, "mark_domain_events_processed", lambda event_ids: calls["processed"].append(event_ids))

    result = projector.process_domain_events(limit=50)

    assert result == {"processed": 1, "ops_refreshes": 1, "home_refreshes": 0}
    assert calls["ops"] == [True]
    assert calls["home"] == []
    assert calls["processed"] == [["1682349000021-0"]]


def test_process_domain_events_queues_post_acquisition_processing_when_artist_is_idle(monkeypatch):
    from crate import projector

    queued: list[tuple[str, bool]] = []
    processed: list[list[str]] = []

    monkeypatch.setattr(
        projector,
        "list_domain_events",
        lambda limit, unprocessed_only=True: [
            {
                "id": "1682349000030-0",
                "event_type": "library.acquisition.completed",
                "scope": "library.acquisition",
                "subject_key": "Terror",
                "payload_json": {"task_id": "abc123", "artist": "Terror", "album": "Pain Into Power", "entity_type": "album"},
            },
        ],
    )
    monkeypatch.setattr(projector, "has_inflight_acquisition_for_artist", lambda artist_name, exclude_task_id=None: False)
    monkeypatch.setattr(projector, "queue_process_new_content_if_needed", lambda artist_name, force=False: queued.append((artist_name, force)) or "task123")
    monkeypatch.setattr(projector, "get_cached_ops_snapshot", lambda fresh=False: {"status": {}})
    monkeypatch.setattr(projector, "get_cached_home_discovery", lambda user_id, fresh=False: {})
    monkeypatch.setattr(projector, "mark_domain_events_processed", lambda event_ids: processed.append(event_ids))

    result = projector.process_domain_events(limit=10)

    assert result == {"processed": 1, "ops_refreshes": 0, "home_refreshes": 0}
    assert queued == [("Terror", True)]
    assert processed == [["1682349000030-0"]]


def test_process_domain_events_skips_post_acquisition_processing_when_artist_still_busy(monkeypatch):
    from crate import projector

    queued: list[tuple[str, bool]] = []
    processed: list[list[str]] = []

    monkeypatch.setattr(
        projector,
        "list_domain_events",
        lambda limit, unprocessed_only=True: [
            {
                "id": "1682349000031-0",
                "event_type": "library.acquisition.completed",
                "scope": "library.acquisition",
                "subject_key": "Terror",
                "payload_json": {"task_id": "abc123", "artist": "Terror", "album": "Pain Into Power", "entity_type": "album"},
            },
        ],
    )
    monkeypatch.setattr(projector, "has_inflight_acquisition_for_artist", lambda artist_name, exclude_task_id=None: True)
    monkeypatch.setattr(projector, "queue_process_new_content_if_needed", lambda artist_name, force=False: queued.append((artist_name, force)) or "task123")
    monkeypatch.setattr(projector, "get_cached_ops_snapshot", lambda fresh=False: {"status": {}})
    monkeypatch.setattr(projector, "get_cached_home_discovery", lambda user_id, fresh=False: {})
    monkeypatch.setattr(projector, "mark_domain_events_processed", lambda event_ids: processed.append(event_ids))

    result = projector.process_domain_events(limit=10)

    assert result == {"processed": 0, "ops_refreshes": 0, "home_refreshes": 0}
    assert queued == []
    assert processed == []
