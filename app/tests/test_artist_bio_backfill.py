from crate.worker_handlers import enrichment


def test_normalize_artist_bios_processes_batches_and_invalidates_changed_surfaces(
    monkeypatch,
):
    batches = iter(
        [
            {
                "scanned": 2,
                "changed": 1,
                "already_clean": 1,
                "locked": 0,
                "empty_after_cleaning": 0,
                "last_id": 12,
                "has_more": True,
            },
            {
                "scanned": 1,
                "changed": 0,
                "already_clean": 1,
                "locked": 0,
                "empty_after_cleaning": 0,
                "last_id": 20,
                "has_more": False,
            },
        ]
    )
    monkeypatch.setattr(
        "crate.db.jobs.artist_bio.normalize_artist_bios_batch",
        lambda **kwargs: next(batches),
    )
    invalidations = []
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *scopes: invalidations.append(scopes),
    )
    monkeypatch.setattr(enrichment, "emit_progress", lambda *args, **kwargs: None)
    monkeypatch.setattr(enrichment, "emit_task_event", lambda *args, **kwargs: None)

    result = enrichment._handle_normalize_artist_bios("task-1", {}, {})

    assert result == {
        "scanned": 3,
        "changed": 1,
        "already_clean": 2,
        "locked": 0,
        "empty_after_cleaning": 0,
        "batches": 2,
    }
    assert invalidations == [("artist_bio", "library", "home", "global_catalog")]
