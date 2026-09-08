from __future__ import annotations

import json
import os
import stat
import time
from io import BytesIO

from PIL import Image


def _jpeg(color: str) -> bytes:
    output = BytesIO()
    Image.new("RGB", (256, 256), color=color).save(output, format="JPEG")
    return output.getvalue()


def test_cleanup_keeps_current_and_one_previous_revision(monkeypatch, tmp_path):
    from crate.artwork_maintenance import cleanup_artwork_variants
    from crate.artwork_materializer import materialize_artwork
    from crate.artwork_variants import ArtworkAsset, artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    asset = ArtworkAsset("album-cover", "album-entity")
    for color in ("red", "green", "blue"):
        materialize_artwork(asset, _jpeg(color))
        time.sleep(0.01)

    result = cleanup_artwork_variants(max_assets=10)

    revision_dirs = [
        path
        for path in artwork_asset_root(asset).iterdir()
        if path.is_dir() and not path.name.startswith(".")
    ]
    assert len(revision_dirs) == 2
    assert result["revisions_removed"] == 1


def test_cleanup_removes_only_expired_temporary_directories(monkeypatch, tmp_path):
    from crate.artwork_maintenance import cleanup_artwork_variants
    from crate.artwork_variants import ArtworkAsset, artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    root = artwork_asset_root(ArtworkAsset("artist-photo", "artist-entity"))
    old_temp = root / ".old.tmp"
    fresh_temp = root / ".fresh.tmp"
    old_temp.mkdir(parents=True)
    fresh_temp.mkdir()
    expired = time.time() - 90000
    os.utime(old_temp, (expired, expired))

    result = cleanup_artwork_variants(max_assets=10)

    assert old_temp.exists() is False
    assert fresh_temp.exists() is True
    assert result["temporary_removed"] == 1


def test_cleanup_artist_hero_publications_keeps_active_previous_and_unknown_orphans(
    monkeypatch, tmp_path
):
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        artist_hero_artifact_root,
    )
    from crate.artwork_maintenance import cleanup_artist_hero_publications

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    current = ArtistHeroArtifactIdentity("artist-entity", "desktop", "current")
    previous = ArtistHeroArtifactIdentity("artist-entity", "desktop", "previous")
    stale = ArtistHeroArtifactIdentity("artist-entity", "desktop", "stale")
    orphan = ArtistHeroArtifactIdentity("artist-entity", "desktop", "orphan")
    for identity in (current, previous, stale, orphan):
        artist_hero_artifact_root(identity).mkdir(parents=True)

    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revision_artists",
        lambda **_kwargs: [
            {"artist_id": 42, "entity_uid": "artist-entity"},
        ],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_artist_hero_artwork",
        lambda _artist_id: {
            "render_manifest": {
                "artifacts": {
                    "desktop": {"render_revision": "current"},
                }
            }
        },
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revisions",
        lambda _artist_id: [
            {
                "composition": "desktop",
                "render_revision": "current",
                "created_at": "2026-09-08T12:00:00+00:00",
            },
            {
                "composition": "desktop",
                "render_revision": "previous",
                "created_at": "2026-09-07T12:00:00+00:00",
            },
            {
                "composition": "desktop",
                "render_revision": "stale",
                "created_at": "2026-09-06T12:00:00+00:00",
            },
        ],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_manifest_history",
        lambda _artist_id: [],
    )
    result = cleanup_artist_hero_publications(max_artists=10)

    assert not artist_hero_artifact_root(stale).exists()
    assert artist_hero_artifact_root(current).exists()
    assert artist_hero_artifact_root(previous).exists()
    assert artist_hero_artifact_root(orphan).exists()
    assert result == {"artists_checked": 1, "revisions_removed": 1}


def test_repair_manifest_permissions_makes_existing_assets_readplane_readable(
    monkeypatch, tmp_path
):
    from crate.artwork_maintenance import repair_artwork_manifest_permissions
    from crate.artwork_variants import ArtworkAsset, artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    root = artwork_asset_root(ArtworkAsset("album-cover", "album-entity"))
    root.mkdir(parents=True)
    manifest = root / "current.json"
    manifest.write_text("{}")
    manifest.chmod(0o600)

    result = repair_artwork_manifest_permissions(max_assets=10)

    assert result == {"assets_checked": 1, "permissions_repaired": 1}
    assert stat.S_IMODE(manifest.stat().st_mode) == 0o644


def test_integrity_sample_reports_invalid_manifests_and_missing_files(
    monkeypatch, tmp_path
):
    from crate.artwork_maintenance import inspect_artwork_variants
    from crate.artwork_variants import ArtworkAsset, artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    invalid_root = artwork_asset_root(ArtworkAsset("album-cover", "album-invalid"))
    invalid_root.mkdir(parents=True)
    (invalid_root / "current.json").write_text("not-json")
    missing_root = artwork_asset_root(ArtworkAsset("artist-photo", "artist-missing"))
    missing_root.mkdir(parents=True)
    (missing_root / "current.json").write_text(
        json.dumps(
            {
                "version": 1,
                "kind": "artist-photo",
                "entity_key": "artist-missing",
                "source_revision": "abc",
                "variants": {"128": "abc/128.webp"},
            }
        )
    )

    result = inspect_artwork_variants(max_assets=10)

    assert result["assets_checked"] == 2
    assert result["invalid_manifests"] == 1
    assert result["missing_variant_files"] == 1
    assert result["corrupt_assets"] == 2


def test_repair_handler_requeues_corrupt_assets(monkeypatch):
    from crate.artwork_variants import ArtworkAsset
    from crate.worker_handlers import artwork

    queued = []
    monkeypatch.setattr(
        artwork,
        "find_corrupt_artwork_assets",
        lambda **_kwargs: [ArtworkAsset("album-cover", "album-entity")],
    )
    monkeypatch.setattr(
        artwork,
        "queue_artwork_materialization",
        lambda asset, *, reason: queued.append((asset, reason)),
    )

    result = artwork._handle_repair_artwork_variants("task-1", {"max_assets": 100}, {})

    assert result == {"assets_checked": 100, "requeued": 1}
    assert queued == [(ArtworkAsset("album-cover", "album-entity"), "integrity-repair")]


def test_repair_handler_fixes_manifest_modes_and_marks_upgrade_complete(monkeypatch):
    from crate.worker_handlers import artwork

    completed = []
    monkeypatch.setattr(artwork, "find_corrupt_artwork_assets", lambda **_kwargs: [])
    monkeypatch.setattr(
        artwork,
        "repair_artwork_manifest_permissions",
        lambda **_kwargs: {"assets_checked": 42, "permissions_repaired": 41},
    )
    monkeypatch.setattr(
        "crate.db.cache_settings.set_setting",
        lambda key, value: completed.append((key, value)),
    )

    result = artwork._handle_repair_artwork_variants(
        "task-1",
        {"max_assets": 100_000, "repair_manifest_permissions": True},
        {},
    )

    assert result == {
        "assets_checked": 100_000,
        "requeued": 0,
        "manifest_assets_checked": 42,
        "permissions_repaired": 41,
    }
    assert completed == [("artwork_manifest_permissions_version", "1")]


def test_normal_health_uses_a_bounded_artwork_integrity_sample(monkeypatch):
    from crate import health_check

    calls = []
    monkeypatch.setattr(
        "crate.artwork_maintenance.inspect_artwork_variants",
        lambda *, max_assets: (
            calls.append(max_assets) or {"assets_checked": 17, "corrupt_assets": 0}
        ),
    )

    assert health_check.artwork_variant_health_sample() == {
        "assets_checked": 17,
        "corrupt_assets": 0,
    }
    assert calls == [100]


def test_artwork_cleanup_is_scheduled_as_bounded_maintenance():
    from crate.scheduler import DEFAULT_SCHEDULES

    assert DEFAULT_SCHEDULES["cleanup_artwork_variants"] == 172800
