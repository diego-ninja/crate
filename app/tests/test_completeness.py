from __future__ import annotations


def test_get_album_names_for_artists_bulk_groups_case_insensitively(monkeypatch):
    from crate.db.jobs import enrichment as enrichment_jobs

    class Result:
        def mappings(self):
            return self

        def all(self):
            return [
                {"artist": "FIRST ARTIST", "name": "First Album"},
                {"artist": "Second Artist", "name": "Second Album"},
            ]

    class Session:
        def execute(self, *_args, **_kwargs):
            return Result()

    class Scope:
        def __enter__(self):
            return Session()

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr(enrichment_jobs, "transaction_scope", lambda: Scope())

    result = enrichment_jobs.get_album_names_for_artists(
        ["First Artist", "Second Artist"]
    )

    assert result == {
        "First Artist": {"first album"},
        "Second Artist": {"second album"},
    }


def test_get_child_task_results_decodes_json(monkeypatch):
    from crate.db.repositories import tasks_maintenance

    class Result:
        def mappings(self):
            return self

        def all(self):
            return [
                {"status": "completed", "result_json": '{"total": 2}'},
                {"status": "failed", "result_json": "not-json"},
            ]

    class Session:
        def execute(self, *_args, **_kwargs):
            return Result()

    class Scope:
        def __enter__(self):
            return Session()

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr(tasks_maintenance, "transaction_scope", lambda: Scope())

    assert tasks_maintenance.get_child_task_results("parent-1") == [
        {"status": "completed", "result": {"total": 2}},
        {"status": "failed", "result": None},
    ]


def test_completeness_refresh_returns_existing_deduplicated_task(monkeypatch):
    from crate.api import browse_media

    monkeypatch.setattr(browse_media, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(browse_media, "create_task_dedup", lambda *_args: None)
    monkeypatch.setattr(
        browse_media,
        "find_active_task_by_type_params",
        lambda *_args: "active-task-1",
    )

    assert browse_media.api_discover_completeness_refresh(object()) == {
        "task_id": "active-task-1"
    }


def _artist(artist_id: int, name: str, mbid: str) -> dict:
    return {
        "id": artist_id,
        "slug": name.lower().replace(" ", "-"),
        "name": name,
        "mbid": mbid,
        "album_count": 1,
        "has_photo": True,
        "listeners": 10,
    }


def test_completeness_coordinator_dispatches_artist_chunks(monkeypatch):
    from crate.worker_handlers import enrichment

    artists = [
        _artist(1, "First Artist", "mbid-1"),
        _artist(2, "Second Artist", "mbid-2"),
        _artist(3, "Third Artist", "mbid-3"),
    ]
    dispatched: list[tuple[str, dict, str]] = []

    monkeypatch.setattr(enrichment, "get_artists_with_mbid", lambda: artists)
    monkeypatch.setattr(enrichment, "COMPLETENESS_CHUNK_SIZE", 2)
    monkeypatch.setattr(enrichment, "emit_task_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(enrichment, "emit_progress", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        "crate.db.repositories.tasks.create_task",
        lambda task_type, params, *, parent_task_id: dispatched.append(
            (task_type, params, parent_task_id)
        ),
    )

    result = enrichment._handle_compute_completeness("parent-1", {}, {})

    assert result == {"_delegated": True, "chunks": 2, "artists": 3}
    assert [item[0] for item in dispatched] == [
        "compute_completeness",
        "compute_completeness",
    ]
    assert [item[2] for item in dispatched] == ["parent-1", "parent-1"]
    assert dispatched[0][1]["artists"] == artists[:2]
    assert dispatched[1][1]["artists"] == artists[2:]


def test_completeness_chunk_uses_cached_musicbrainz_data(monkeypatch):
    from crate.worker_handlers import enrichment

    artist = _artist(1, "First Artist", "mbid-1")
    cached = {
        "count": 2,
        "albums": [
            {"title": "First Album", "type": "Album", "year": "2020"},
            {"title": "Missing Album", "type": "Album", "year": "2021"},
        ],
    }
    monkeypatch.setattr(enrichment, "get_cache", lambda *_args, **_kwargs: cached)
    monkeypatch.setattr(
        enrichment,
        "get_album_names_for_artists",
        lambda _names: {"First Artist": {"first album"}},
    )
    monkeypatch.setattr(enrichment, "emit_progress", lambda *_args, **_kwargs: None)

    result = enrichment._handle_compute_completeness(
        "chunk-1", {"artists": [artist], "_chunk": True}, {}
    )

    assert result["artists_checked"] == 1
    assert result["total"] == 1
    assert result["results"] == [
        {
            "artist_id": 1,
            "artist_entity_uid": None,
            "artist_slug": "first-artist",
            "artist": "First Artist",
            "has_photo": True,
            "listeners": 10,
            "local_count": 1,
            "mb_count": 2,
            "pct": 50,
            "missing": [{"title": "Missing Album", "type": "Album", "year": "2021"}],
        }
    ]


def test_completeness_finalizer_merges_children_before_publishing_cache(monkeypatch):
    from crate.worker_handlers import enrichment

    child_results = [
        {
            "status": "completed",
            "result": {
                "artists_checked": 1,
                "total": 1,
                "results": [{"artist": "Zulu", "pct": 90}],
            },
        },
        {
            "status": "completed",
            "result": {
                "artists_checked": 1,
                "total": 1,
                "results": [{"artist": "Alpha", "pct": 40}],
            },
        },
    ]
    cached: list[tuple[str, object, int]] = []
    events: list[tuple[str, str, dict]] = []

    monkeypatch.setattr(
        "crate.db.repositories.tasks.get_child_task_results",
        lambda _parent_id: child_results,
    )
    monkeypatch.setattr(
        enrichment,
        "set_cache",
        lambda key, value, ttl=None: cached.append((key, value, ttl)),
    )
    monkeypatch.setattr(
        enrichment,
        "emit_task_event",
        lambda task_id, level, payload: events.append((task_id, level, payload)),
    )

    result = enrichment._completeness_finalize("parent-1")

    assert result == {
        "cache_written": True,
        "artists_checked": 2,
        "total": 2,
    }
    assert cached == [
        (
            "discover:completeness",
            [{"artist": "Alpha", "pct": 40}, {"artist": "Zulu", "pct": 90}],
            86400,
        )
    ]
    assert events[-1] == (
        "parent-1",
        "info",
        {"message": "Completeness computed: 2/2 artists checked"},
    )


def test_completeness_finalizer_preserves_cache_when_child_failed(monkeypatch):
    from crate.worker_handlers import enrichment

    monkeypatch.setattr(enrichment, "emit_task_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        "crate.db.repositories.tasks.get_child_task_results",
        lambda _parent_id: [
            {
                "status": "failed",
                "result": None,
            }
        ],
    )
    monkeypatch.setattr(
        enrichment,
        "set_cache",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("partial completeness must not replace the cache")
        ),
    )

    result = enrichment._completeness_finalize("parent-1")

    assert result == {
        "cache_written": False,
        "artists_checked": 0,
        "total": 0,
        "failed_chunks": 1,
    }


def test_completeness_finalizer_preserves_cache_when_artist_failed(monkeypatch):
    from crate.worker_handlers import enrichment

    monkeypatch.setattr(enrichment, "emit_task_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        "crate.db.repositories.tasks.get_child_task_results",
        lambda _parent_id: [
            {
                "status": "completed",
                "result": {
                    "artists_checked": 1,
                    "total": 2,
                    "failed_artists": 1,
                    "results": [{"artist": "Healthy", "pct": 80}],
                },
            }
        ],
    )
    monkeypatch.setattr(
        enrichment,
        "set_cache",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("partial completeness must not replace the cache")
        ),
    )

    result = enrichment._completeness_finalize("parent-1")

    assert result == {
        "cache_written": False,
        "artists_checked": 1,
        "total": 2,
        "failed_artists": 1,
    }


def test_fan_in_passes_parent_id_to_completeness_finalizer(monkeypatch):
    from crate.worker_handlers import analysis

    finalized: list[str] = []
    updated: list[dict] = []
    monkeypatch.setattr(
        "crate.db.repositories.tasks.check_siblings_complete",
        lambda _parent_id: {
            "all_done": True,
            "total": 2,
            "completed": 2,
            "failed": 0,
        },
    )
    monkeypatch.setattr(
        "crate.db.repositories.tasks.update_task",
        lambda _task_id, **kwargs: updated.append(kwargs),
    )
    monkeypatch.setattr(analysis, "emit_task_event", lambda *_args, **_kwargs: None)
    monkeypatch.setitem(
        analysis._PARENT_FINALIZERS,
        "compute_completeness",
        lambda parent_id: finalized.append(parent_id) or {"cache_written": True},
    )

    analysis._try_complete_parent("parent-1", "compute_completeness")

    assert finalized == ["parent-1"]
    assert updated[0]["result"]["cache_written"] is True


def test_musicbrainz_completeness_fetch_pages_release_groups(monkeypatch):
    from crate.worker_handlers import enrichment

    calls: list[int] = []

    def browse_release_groups(*, artist, release_type, limit, offset=0):
        assert artist == "mbid-1"
        assert release_type == ["album"]
        assert limit == 100
        calls.append(offset)
        if offset == 0:
            return {
                "release-group-count": 150,
                "release-group-list": [
                    {"title": "Album 1", "primary-type": "Album"},
                    *[
                        {"title": f"Album {index}", "primary-type": "Album"}
                        for index in range(2, 101)
                    ],
                ],
            }
        return {
            "release-group-count": 150,
            "release-group-list": [
                {
                    "title": f"Album {index}",
                    "primary-type": "Album",
                }
                for index in range(101, 151)
            ],
        }

    monkeypatch.setattr(enrichment, "wait_for_provider_slot", lambda *_args: 0)
    monkeypatch.setattr(enrichment, "get_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(enrichment, "set_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        "musicbrainzngs.get_artist_by_id",
        lambda _mbid: {"artist": {"name": "First Artist"}},
    )
    monkeypatch.setattr("musicbrainzngs.browse_release_groups", browse_release_groups)

    result = enrichment._fetch_completeness_musicbrainz("mbid-1", "First Artist")

    assert calls == [0, 100]
    assert result["count"] == 150
    assert len(result["albums"]) == 150
    assert result["albums"][0]["title"] == "Album 1"
    assert result["albums"][-1]["title"] == "Album 150"
