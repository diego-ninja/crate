def test_registered_actors_keep_configured_priority():
    from crate import actors

    for task_type, (_queue, priority, _timeout_sec, _max_retries) in actors.TASK_POOL_CONFIG.items():
        actor = actors.get_actor(task_type)

        assert actor is not None
        assert actor.priority == priority


def test_enrich_mbids_is_resource_governed_but_not_db_heavy():
    from crate import actors
    from crate import resource_governor
    from crate.db.repositories import tasks_shared

    assert "enrich_mbids" in resource_governor.RESOURCE_GOVERNED_TASK_TYPES
    assert "enrich_mbids" not in actors.DB_HEAVY_TASK_TYPES
    assert "enrich_mbids" not in tasks_shared.DB_HEAVY_TASKS
