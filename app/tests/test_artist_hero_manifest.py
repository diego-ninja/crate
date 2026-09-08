from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _recipe() -> dict[str, object]:
    return {
        "mode": "extend",
        "crop": {"x": 0, "y": 0, "width": 2000, "height": 1000},
        "position_x": 0.5,
        "position_y": 0.5,
        "scale": 1.0,
        "blur": 0,
        "feather": 0,
        "gradient": 0,
    }


def _profile(*, render_manifest: dict | None = None) -> dict:
    profile = {
        "provenance": "manual",
        "review_status": "approved",
        "source_width": 2000,
        "source_height": 1000,
        "desktop_source_width": 2000,
        "desktop_source_height": 1000,
        "mobile_source_width": 1000,
        "mobile_source_height": 1500,
        "desktop_recipe": _recipe(),
        "mobile_recipe": _recipe(),
        "revision": "editorial-42",
        "desktop_enabled": True,
        "mobile_enabled": True,
    }
    if render_manifest is not None:
        profile["render_manifest"] = render_manifest
    return profile


def _manifest(renderer_version: str = "cover-fit-v4") -> dict:
    return {
        "manifest_version": 1,
        "editorial_revision": "editorial-42",
        "artifacts": {
            "desktop": {
                "renderer_version": renderer_version,
                "render_revision": "artifact-desktop-1",
                "source_fingerprint": "sha256:desktop-source",
                "recipe_hash": "desktop-recipe-hash",
                "relative_path": "artist-hero/42/desktop/artifact-desktop-1.webp",
            },
            "mobile": {
                "renderer_version": renderer_version,
                "render_revision": "artifact-mobile-1",
                "source_fingerprint": "sha256:mobile-source",
                "recipe_hash": "mobile-recipe-hash",
                "relative_path": "artist-hero/42/mobile/artifact-mobile-1.webp",
            },
        },
    }


def test_legacy_profile_keeps_the_v1_public_contract() -> None:
    from crate.artist_hero_contract import artist_hero_profile_contract

    contract = artist_hero_profile_contract(artist_id=42, profile=_profile())

    assert contract["schema_version"] == 1
    assert "render_manifest" not in contract
    assert contract["compositions"]["desktop"]["render_revision"] == "editorial-42"


def test_manifest_profile_exposes_v2_without_leaking_internal_paths() -> None:
    from crate.artist_hero_contract import artist_hero_profile_contract

    contract = artist_hero_profile_contract(
        artist_id=42,
        profile=_profile(render_manifest=_manifest()),
    )

    assert contract["schema_version"] == 2
    public_manifest = contract["render_manifest"]
    assert public_manifest["manifest_version"] == 1
    desktop = public_manifest["artifacts"]["desktop"]
    assert desktop["render_revision"] == "artifact-desktop-1"
    assert desktop["asset_path"].endswith("v=artifact-desktop-1")
    assert "relative_path" not in desktop
    assert contract["compositions"]["desktop"]["render_revision"] == (
        "artifact-desktop-1"
    )


def test_public_schema_accepts_legacy_and_manifest_contracts() -> None:
    from datetime import datetime, timezone

    from crate.api.schemas.artwork import ArtistHeroArtworkResponse
    from crate.artist_hero_contract import artist_hero_profile_contract

    profile = _profile(render_manifest=_manifest())
    payload = {
        "artist_id": 42,
        "updated_at": datetime.now(timezone.utc),
        **profile,
        **artist_hero_profile_contract(artist_id=42, profile=profile),
    }

    validated = ArtistHeroArtworkResponse.model_validate(payload)

    assert validated.schema_version == 2
    assert validated.render_manifest is not None
    assert validated.render_manifest.artifacts["desktop"].asset_path.endswith(
        "v=artifact-desktop-1"
    )


def test_profile_endpoint_does_not_expose_internal_manifest_paths(test_app) -> None:
    from unittest.mock import patch

    profile = _profile(render_manifest=_manifest())
    profile["updated_at"] = "2026-09-08T12:00:00+00:00"

    with (
        patch("crate.api.artwork.artist_name_from_id", return_value="Converge"),
        patch("crate.api.artwork.get_artist_hero_artwork", return_value=profile),
        patch(
            "crate.api.artwork.get_artist_featured_state",
            return_value={"is_featured": False},
        ),
    ):
        response = test_app.get("/api/artwork/artists/42/hero-profile")

    assert response.status_code == 200
    assert "relative_path" not in response.text
    assert response.json()["render_manifest"]["artifacts"]["desktop"][
        "asset_path"
    ].endswith("v=artifact-desktop-1")


def test_manifest_readiness_uses_supported_renderer_policy() -> None:
    from crate.artist_hero_contract import (
        artist_hero_profile_ready_compositions,
    )

    assert artist_hero_profile_ready_compositions(
        _profile(render_manifest=_manifest())
    ) == (
        "desktop",
        "mobile",
    )
    assert (
        artist_hero_profile_ready_compositions(
            _profile(render_manifest=_manifest(renderer_version="unknown-renderer"))
        )
        == ()
    )


def test_artist_hero_manifest_migration_is_the_next_revision() -> None:
    migration = (
        ROOT / "app/crate/db/migrations/versions/091_artist_hero_render_manifest.py"
    ).read_text()

    assert 'revision = "091"' in migration
    assert 'down_revision = "090"' in migration
    assert '"render_manifest"' in migration
    assert "JSONB" in migration
