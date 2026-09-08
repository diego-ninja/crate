from __future__ import annotations

import pytest

from tests.conftest import PG_AVAILABLE


def _manifest(editorial_revision: str, render_revision: str) -> dict:
    return {
        "manifest_version": 1,
        "editorial_revision": editorial_revision,
        "artifacts": {
            "desktop": {
                "renderer_version": "cover-fit-v4",
                "render_revision": render_revision,
                "source_fingerprint": f"sha256:{render_revision}",
                "recipe_hash": f"recipe:{render_revision}",
                "relative_path": (
                    "artist-hero-publications/v1/artist-42/desktop/"
                    f"{render_revision}/artifact.webp"
                ),
            }
        },
    }


def test_manifest_identity_is_stable_and_order_independent() -> None:
    from crate.db.repositories.artist_hero_artwork import (
        artist_hero_manifest_id,
    )

    first = _manifest("editorial-1", "artifact-a")
    reordered = {
        "artifacts": first["artifacts"],
        "editorial_revision": first["editorial_revision"],
        "manifest_version": first["manifest_version"],
    }

    assert artist_hero_manifest_id(first) == artist_hero_manifest_id(reordered)
    assert artist_hero_manifest_id(first) != artist_hero_manifest_id(
        _manifest("editorial-1", "artifact-b")
    )


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_manifest_history_persists_previous_and_uses_manifest_cas(pg_db) -> None:
    from sqlalchemy import text

    from crate.db.repositories.artist_hero_artwork import (
        compare_and_swap_artist_hero_manifest,
        get_artist_hero_artwork,
        list_artist_hero_manifest_history,
        upsert_artist_hero_artwork,
    )
    from crate.db.tx import read_scope

    pg_db.upsert_artist({"name": "Manifest History Artist"})
    with read_scope() as session:
        artist_id = session.execute(
            text(
                "SELECT id FROM library_artists WHERE name = 'Manifest History Artist'"
            )
        ).scalar_one()

    base = {
        "artist_id": artist_id,
        "provenance": "manual",
        "review_status": "approved",
        "source_width": 1600,
        "source_height": 1000,
        "desktop_recipe": {"mode": "crop"},
        "mobile_recipe": {"mode": "crop"},
        "desktop_enabled": True,
        "mobile_enabled": False,
    }
    manifest_a = _manifest("editorial-1", "artifact-a")
    manifest_b = _manifest("editorial-1", "artifact-b")
    manifest_c = _manifest("editorial-1", "artifact-c")

    assert upsert_artist_hero_artwork(
        **base, revision="editorial-1", render_manifest=manifest_a
    )
    assert compare_and_swap_artist_hero_manifest(
        artist_id=artist_id,
        expected_revision="editorial-1",
        expected_manifest=manifest_a,
        render_manifest=manifest_b,
    )
    assert not compare_and_swap_artist_hero_manifest(
        artist_id=artist_id,
        expected_revision="editorial-1",
        expected_manifest=manifest_a,
        render_manifest=manifest_c,
    )

    profile = get_artist_hero_artwork(artist_id)
    assert profile is not None
    assert profile["render_manifest"] == manifest_b
    assert profile["review_status"] == "approved"
    assert profile["provenance"] == "manual"

    history = list_artist_hero_manifest_history(artist_id)
    assert [entry["manifest"] for entry in history] == [manifest_b, manifest_a]
    assert history[0]["previous_manifest"] == manifest_a


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_manifest_rollback_rejects_a_stale_active_pointer(pg_db) -> None:
    from sqlalchemy import text

    from crate.db.repositories.artist_hero_artwork import (
        artist_hero_manifest_id,
        compare_and_swap_artist_hero_manifest,
        get_artist_hero_artwork,
        rollback_artist_hero_manifest,
        upsert_artist_hero_artwork,
    )
    from crate.db.tx import read_scope

    pg_db.upsert_artist({"name": "Manifest Rollback Artist"})
    with read_scope() as session:
        artist_id = session.execute(
            text(
                "SELECT id FROM library_artists WHERE name = 'Manifest Rollback Artist'"
            )
        ).scalar_one()

    base = {
        "artist_id": artist_id,
        "provenance": "manual",
        "review_status": "approved",
        "source_width": 1600,
        "source_height": 1000,
        "desktop_recipe": {"mode": "crop"},
        "mobile_recipe": {"mode": "crop"},
        "desktop_enabled": True,
        "mobile_enabled": False,
    }
    manifest_a = _manifest("editorial-1", "artifact-a")
    manifest_b = _manifest("editorial-1", "artifact-b")
    manifest_c = _manifest("editorial-1", "artifact-c")
    assert upsert_artist_hero_artwork(
        **base, revision="editorial-1", render_manifest=manifest_a
    )
    assert compare_and_swap_artist_hero_manifest(
        artist_id=artist_id,
        expected_revision="editorial-1",
        expected_manifest=manifest_a,
        render_manifest=manifest_b,
    )
    assert compare_and_swap_artist_hero_manifest(
        artist_id=artist_id,
        expected_revision="editorial-1",
        expected_manifest=manifest_b,
        render_manifest=manifest_c,
    )

    assert not rollback_artist_hero_manifest(
        artist_id=artist_id,
        expected_revision="editorial-1",
        expected_manifest=manifest_a,
        target_manifest_id=artist_hero_manifest_id(manifest_b),
    )
    assert rollback_artist_hero_manifest(
        artist_id=artist_id,
        expected_revision="editorial-1",
        expected_manifest=manifest_c,
        target_manifest_id=artist_hero_manifest_id(manifest_b),
    )
    assert get_artist_hero_artwork(artist_id)["render_manifest"] == manifest_b
