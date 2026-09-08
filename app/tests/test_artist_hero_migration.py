from __future__ import annotations

from pathlib import Path

from PIL import Image
import pytest

from crate.artist_hero_migration import (
    migration_task_dedup_key,
    plan_artist_hero_migration,
)
from crate.worker_handlers import artwork as artwork_handlers


def _profile(**overrides: object) -> dict:
    profile = {
        "revision": "editorial-revision-1",
        "desktop_enabled": True,
        "mobile_enabled": True,
        "desktop_recipe": {"mode": "extend"},
        "mobile_recipe": {"mode": "extend"},
        "render_manifest": None,
    }
    profile.update(overrides)
    return profile


def _artist() -> dict:
    return {"id": 42, "entity_uid": "artist-42", "name": "Example Artist"}


def test_plan_uses_shared_legacy_source_for_both_enabled_compositions(
    tmp_path: Path,
) -> None:
    source = tmp_path / "artist-hero-source.jpg"
    source.write_bytes(b"legacy-source")

    plan = plan_artist_hero_migration(
        artist_row=_artist(), profile=_profile(), artist_dir=tmp_path
    )

    assert plan.skip_reason is None
    assert plan.enabled == ("desktop", "mobile")
    assert plan.source_paths == {"desktop": source, "mobile": source}


def test_plan_reports_missing_source_without_partial_composition_plan(
    tmp_path: Path,
) -> None:
    source = tmp_path / "artist-hero-source-desktop.jpg"
    source.write_bytes(b"desktop-source")

    plan = plan_artist_hero_migration(
        artist_row=_artist(), profile=_profile(), artist_dir=tmp_path
    )

    assert plan.skip_reason == "missing-source:mobile"
    assert plan.source_paths == {}


def test_plan_reports_missing_recipe_before_reading_sources(tmp_path: Path) -> None:
    (tmp_path / "artist-hero-source.jpg").write_bytes(b"legacy-source")

    plan = plan_artist_hero_migration(
        artist_row=_artist(),
        profile=_profile(mobile_recipe={}),
        artist_dir=tmp_path,
    )

    assert plan.skip_reason == "missing-recipe:mobile"
    assert plan.source_paths == {}


def test_plan_is_idempotently_skipped_when_active_manifest_covers_enabled_slots(
    tmp_path: Path,
) -> None:
    manifest = {
        "artifacts": {
            "desktop": {"relative_path": "desktop.webp"},
            "mobile": {"relative_path": "mobile.webp"},
        }
    }

    plan = plan_artist_hero_migration(
        artist_row=_artist(),
        profile=_profile(render_manifest=manifest),
        artist_dir=tmp_path,
    )

    assert plan.skip_reason == "already-published"


def test_migration_task_dedup_key_is_revision_scoped() -> None:
    assert migration_task_dedup_key(42, "rev-a") == "migrate-artist-hero:42:rev-a"
    assert migration_task_dedup_key(42, "rev-b") != migration_task_dedup_key(
        42, "rev-a"
    )


def test_canary_cursor_reports_skips_and_queues_only_the_next_cursor(
    tmp_path: Path, monkeypatch
) -> None:
    (tmp_path / "artist-hero-source.jpg").write_bytes(b"legacy-source")
    candidates = [
        {"id": 42, "name": "Example Artist", "entity_uid": "artist-42"},
        {"id": 43, "name": "Missing Recipe", "entity_uid": "artist-43"},
    ]
    profiles = {
        42: _profile(),
        43: _profile(mobile_recipe={}),
    }
    queued: list[tuple[str, dict, str]] = []

    monkeypatch.setattr(
        artwork_handlers,
        "list_artist_hero_migration_candidates",
        lambda *, after_id, limit: candidates,
    )
    monkeypatch.setattr(
        artwork_handlers,
        "get_artist_hero_artwork",
        lambda artist_id: profiles[artist_id],
    )
    monkeypatch.setattr(
        artwork_handlers,
        "resolve_artist_dir",
        lambda *args, **kwargs: tmp_path,
    )
    monkeypatch.setattr(
        artwork_handlers,
        "create_task_dedup",
        lambda task_type, params, *, dedup_key: queued.append(
            (task_type, params, dedup_key)
        ),
    )

    result = artwork_handlers._handle_migrate_artist_heroes(
        "task-1",
        {"after_artist_id": 0, "batch_size": 2, "dry_run": True},
        {"library_path": str(tmp_path)},
    )

    assert result == {
        "status": "continued",
        "dry_run": True,
        "scanned": 2,
        "planned": 1,
        "targets": [
            {
                "artist_id": 42,
                "expected_revision": "editorial-revision-1",
                "dedup_key": "migrate-artist-hero:42:editorial-revision-1",
            }
        ],
        "skipped": {"missing-recipe:mobile": 1},
        "after_artist_id": 43,
        "next_queued": True,
    }
    assert queued == [
        (
            "migrate_artist_heroes",
            {"after_artist_id": 43, "batch_size": 2, "dry_run": True},
            "migrate-artist-heroes:canary:1:43:2",
        )
    ]


def test_canary_execution_queues_each_target_only_after_planning(
    tmp_path: Path, monkeypatch
) -> None:
    (tmp_path / "artist-hero-source.jpg").write_bytes(b"legacy-source")
    candidate = {"id": 42, "name": "Example Artist", "entity_uid": "artist-42"}
    queued: list[tuple[str, dict, str]] = []

    monkeypatch.setattr(
        artwork_handlers,
        "list_artist_hero_migration_candidates",
        lambda *, after_id, limit: [candidate],
    )
    monkeypatch.setattr(
        artwork_handlers,
        "get_artist_hero_artwork",
        lambda _artist_id: _profile(),
    )
    monkeypatch.setattr(
        artwork_handlers,
        "resolve_artist_dir",
        lambda *args, **kwargs: tmp_path,
    )
    monkeypatch.setattr(
        artwork_handlers,
        "create_task_dedup",
        lambda task_type, params, *, dedup_key: queued.append(
            (task_type, params, dedup_key)
        ),
    )

    result = artwork_handlers._handle_migrate_artist_heroes(
        "task-1",
        {"after_artist_id": 0, "batch_size": 1, "dry_run": False},
        {"library_path": str(tmp_path)},
    )

    assert result["status"] == "continued"
    assert result["dry_run"] is False
    assert result["queued_targets"] == 1
    assert queued == [
        (
            "migrate_artist_hero",
            {"artist_id": 42, "expected_revision": "editorial-revision-1"},
            "migrate-artist-hero:42:editorial-revision-1",
        ),
        (
            "migrate_artist_heroes",
            {"after_artist_id": 42, "batch_size": 1, "dry_run": False},
            "migrate-artist-heroes:canary:1:42:1",
        ),
    ]


def test_migration_target_publishes_the_enabled_bundle_with_manifest_cas(
    tmp_path: Path, monkeypatch
) -> None:
    source = tmp_path / "artist-hero-source.jpg"
    Image.new("RGB", (1600, 1000), color=(20, 80, 120)).save(source, "JPEG")
    profile = _profile(render_manifest=None)
    published: list[dict] = []
    activated: list[dict] = []
    queued: list[tuple[str, str]] = []

    monkeypatch.setattr(
        artwork_handlers,
        "get_library_artist_by_id",
        lambda _name: _artist(),
    )
    monkeypatch.setattr(
        artwork_handlers,
        "get_artist_hero_artwork",
        lambda _artist_id: profile,
    )
    monkeypatch.setattr(
        artwork_handlers,
        "resolve_artist_dir",
        lambda *args, **kwargs: tmp_path,
    )
    monkeypatch.setattr(
        artwork_handlers,
        "_publish_artist_hero_manifest",
        lambda **kwargs: (
            published.append(kwargs)
            or {
                "manifest_version": 1,
                "editorial_revision": kwargs["editorial_revision"],
                "artifacts": {
                    composition: {"render_revision": "artifact-1"}
                    for composition in kwargs["enabled"]
                },
            }
        ),
    )
    monkeypatch.setattr(
        artwork_handlers,
        "compare_and_swap_artist_hero_manifest",
        lambda **kwargs: activated.append(kwargs) or True,
    )
    monkeypatch.setattr(
        artwork_handlers,
        "queue_artwork_materialization",
        lambda asset, *, reason: queued.append((asset.entity_key, reason)),
    )

    result = artwork_handlers._handle_migrate_artist_hero(
        "task-1",
        {"artist_id": 42, "expected_revision": "editorial-revision-1"},
        {"library_path": str(tmp_path)},
    )

    assert result == {
        "status": "migrated",
        "artist_id": 42,
        "editorial_revision": "editorial-revision-1",
        "enabled": ["desktop", "mobile"],
    }
    assert published[0]["enabled"] == ("desktop", "mobile")
    assert published[0]["editorial_revision"] == "editorial-revision-1"
    assert published[0]["artifact_revision"]
    assert activated[0]["expected_revision"] == "editorial-revision-1"
    assert activated[0]["expected_manifest"] is None
    assert queued == [
        ("artist-42:desktop:artifact-1", "renderer-migration"),
        ("artist-42:mobile:artifact-1", "renderer-migration"),
    ]


def test_migration_target_rejects_a_stale_editorial_revision(
    tmp_path: Path, monkeypatch
) -> None:
    profile = _profile(revision="new-revision")
    monkeypatch.setattr(
        artwork_handlers,
        "get_library_artist_by_id",
        lambda _name: _artist(),
    )
    monkeypatch.setattr(
        artwork_handlers,
        "get_artist_hero_artwork",
        lambda _artist_id: profile,
    )
    monkeypatch.setattr(
        artwork_handlers,
        "_publish_artist_hero_manifest",
        lambda **_kwargs: pytest.fail("stale migration must not publish"),
    )

    result = artwork_handlers._handle_migrate_artist_hero(
        "task-1",
        {"artist_id": 42, "expected_revision": "old-revision"},
        {"library_path": str(tmp_path)},
    )

    assert result == {
        "status": "conflict",
        "reason": "artist-hero-profile-changed",
        "artist_id": 42,
    }


def test_rollback_worker_activates_retained_manifest_and_materializes_it(
    tmp_path: Path, monkeypatch
) -> None:
    from crate.db.repositories.artist_hero_artwork import artist_hero_manifest_id

    current = _profile(
        render_manifest={
            "manifest_version": 1,
            "editorial_revision": "editorial-revision-1",
            "artifacts": {
                "desktop": {"render_revision": "artifact-c"},
                "mobile": {"render_revision": "artifact-c"},
            },
        }
    )
    target = {
        **current,
        "render_manifest": {
            "manifest_version": 1,
            "editorial_revision": "editorial-revision-1",
            "artifacts": {
                "desktop": {"render_revision": "artifact-b"},
                "mobile": {"render_revision": "artifact-b"},
            },
        },
    }
    profiles = iter((current, target))
    activated: list[dict] = []
    queued: list[str] = []
    monkeypatch.setattr(
        artwork_handlers,
        "get_library_artist_by_id",
        lambda _artist_id: _artist(),
    )
    monkeypatch.setattr(
        artwork_handlers,
        "get_artist_hero_artwork",
        lambda _artist_id: next(profiles),
    )
    monkeypatch.setattr(
        artwork_handlers,
        "rollback_artist_hero_manifest",
        lambda **kwargs: activated.append(kwargs) or True,
    )
    monkeypatch.setattr(
        artwork_handlers,
        "queue_artwork_materialization",
        lambda asset, *, reason: queued.append(asset.entity_key),
    )

    result = artwork_handlers._handle_rollback_artist_hero(
        "task-rollback",
        {
            "artist_id": 42,
            "expected_revision": "editorial-revision-1",
            "expected_active_manifest_id": artist_hero_manifest_id(
                current["render_manifest"]
            ),
            "target_manifest_id": "sha256:manifest-b",
        },
        {"library_path": str(tmp_path)},
    )

    assert result == {
        "status": "rolled_back",
        "artist_id": 42,
        "target_manifest_id": "sha256:manifest-b",
    }
    assert activated[0]["expected_revision"] == "editorial-revision-1"
    assert activated[0]["expected_manifest"] == current["render_manifest"]
    assert queued == ["artist-42:desktop:artifact-b", "artist-42:mobile:artifact-b"]
