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
