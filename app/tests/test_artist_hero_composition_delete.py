from __future__ import annotations

from unittest.mock import patch

import pytest


def _profile() -> dict:
    from crate.artist_hero_artwork import ARTIST_HERO_RENDER_VERSION

    recipe = {
        "mode": "crop",
        "crop": {"x": 0, "y": 0, "width": 1600, "height": 1000},
        "position_x": 0.5,
        "position_y": 0.5,
        "scale": 1,
    }
    return {
        "provenance": "manual",
        "review_status": "approved",
        "source_width": 1600,
        "source_height": 1000,
        "desktop_source_width": 1600,
        "desktop_source_height": 1000,
        "mobile_source_width": 1600,
        "mobile_source_height": 1000,
        "desktop_recipe": recipe,
        "mobile_recipe": recipe,
        "revision": f"{ARTIST_HERO_RENDER_VERSION}:revision",
        "desktop_enabled": True,
        "mobile_enabled": True,
    }


def test_disabled_composition_is_not_exposed_by_canonical_contract():
    from crate.artist_hero_contract import (
        artist_hero_profile_compositions,
        artist_hero_profile_ready_compositions,
    )

    profile = _profile()
    profile["mobile_enabled"] = False

    compositions = artist_hero_profile_compositions(artist_id=7, profile=profile)

    assert tuple(compositions) == ("desktop",)
    assert artist_hero_profile_ready_compositions(profile) == ("desktop",)


def test_legacy_profile_without_enabled_flags_remains_compatible():
    from crate.artist_hero_contract import artist_hero_profile_ready_compositions

    profile = _profile()
    profile.pop("desktop_enabled")
    profile.pop("mobile_enabled")

    assert artist_hero_profile_ready_compositions(profile) == ("desktop", "mobile")


def test_delete_worker_removes_only_deleted_composition_files(monkeypatch, tmp_path):
    from crate.worker_handlers.artwork import _handle_delete_artist_hero_composition

    artist_dir = tmp_path / "Converge"
    artist_dir.mkdir()
    for filename in (
        "artist-hero-source-desktop.jpg",
        "artist-hero-source-mobile.jpg",
        "artist-hero-source.jpg",
        "artist-hero-desktop.webp",
        "artist-hero-mobile.webp",
    ):
        (artist_dir / filename).write_bytes(b"artwork")

    deleted: list[tuple[int, str]] = []
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_library_artist",
        lambda _artist: {"id": 7, "name": "Converge"},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.resolve_artist_dir",
        lambda *_args, **_kwargs: artist_dir,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_artist_hero_artwork",
        lambda _artist_id: _profile(),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.delete_artist_hero_composition",
        lambda artist_id, composition: (
            deleted.append((artist_id, composition))
            or {"remaining_compositions": ["mobile"]}
        ),
    )

    with (
        patch("crate.worker_handlers.artwork._broadcast_artwork_invalidation"),
        patch("crate.worker_handlers.artwork._warm_recent_home_discovery_snapshots"),
    ):
        result = _handle_delete_artist_hero_composition(
            "task-delete-1",
            {"artist": "Converge", "artist_id": 7, "composition": "desktop"},
            {"library_path": str(tmp_path)},
        )

    assert result["status"] == "deleted"
    assert deleted == [(7, "desktop")]
    assert not (artist_dir / "artist-hero-source-desktop.jpg").exists()
    assert not (artist_dir / "artist-hero-desktop.webp").exists()
    assert (artist_dir / "artist-hero-source-mobile.jpg").exists()
    assert (artist_dir / "artist-hero-mobile.webp").exists()
    assert (artist_dir / "artist-hero-source.jpg").exists()


def test_delete_worker_does_not_remove_files_for_stale_profile_revision(
    monkeypatch, tmp_path
):
    from crate.worker_handlers.artwork import _handle_delete_artist_hero_composition

    artist_dir = tmp_path / "Converge"
    artist_dir.mkdir()
    source = artist_dir / "artist-hero-source-desktop.jpg"
    source.write_bytes(b"artwork")
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_library_artist",
        lambda _artist: {"id": 7, "name": "Converge"},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.resolve_artist_dir",
        lambda *_args, **_kwargs: artist_dir,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_artist_hero_artwork",
        lambda _artist_id: _profile(),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.delete_artist_hero_composition",
        lambda **_kwargs: pytest.fail("stale delete must not reach the repository"),
    )

    result = _handle_delete_artist_hero_composition(
        "task-delete-1",
        {
            "artist": "Converge",
            "artist_id": 7,
            "composition": "desktop",
            "expected_revision": "stale-revision",
        },
        {"library_path": str(tmp_path)},
    )

    assert result == {
        "status": "conflict",
        "reason": "artist-hero-profile-changed",
        "artist_id": 7,
    }
    assert source.exists()
