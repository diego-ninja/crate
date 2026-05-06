def test_every_registered_handler_has_an_actor_config():
    from crate.actors import TASK_POOL_CONFIG
    from crate.worker import TASK_HANDLERS

    assert sorted(set(TASK_HANDLERS) - set(TASK_POOL_CONFIG)) == []
    assert sorted(set(TASK_POOL_CONFIG) - set(TASK_HANDLERS)) == []


def test_actor_treats_handler_error_result_as_failed(monkeypatch):
    from crate import actors
    from crate.worker import TASK_HANDLERS

    class Allowed:
        allowed = True

    task = {
        "id": "child-task",
        "type": "scan",
        "status": "pending",
        "params": {},
        "created_at": None,
        "parent_task_id": "parent-task",
    }
    updates: list[dict] = []
    fan_in: list[tuple[str, str]] = []

    monkeypatch.setattr("crate.db.queries.tasks.get_task", lambda task_id: task)
    monkeypatch.setattr("crate.db.repositories.tasks.start_task", lambda task_id, worker_id=None: {"id": task_id})
    monkeypatch.setattr(
        "crate.db.repositories.tasks.update_task",
        lambda task_id, **kwargs: updates.append({"task_id": task_id, **kwargs}),
    )
    monkeypatch.setattr("crate.resource_governor.should_defer_task", lambda task_type, params=None: Allowed())
    monkeypatch.setattr("crate.resource_governor.record_decision", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.config.load_config", lambda: {"library_path": "/tmp"})
    monkeypatch.setattr("crate.worker._is_cancelled", lambda task_id: False)
    monkeypatch.setattr("crate.worker_handlers.analysis._try_complete_parent", lambda parent_id, task_type: fan_in.append((parent_id, task_type)))
    monkeypatch.setattr("crate.telegram.notify_task_failed", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.db.events._publish_to_redis", lambda *args, **kwargs: None)
    monkeypatch.setattr(actors, "_check_memory", lambda: None)
    monkeypatch.setitem(TASK_HANDLERS, "scan", lambda task_id, params, config: {"error": "boom"})

    actors._execute_task("scan", "child-task")

    assert any(update.get("status") == "failed" and update.get("error") == "boom" for update in updates)
    assert fan_in == [("parent-task", "scan")]
