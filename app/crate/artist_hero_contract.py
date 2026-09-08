"""Canonical metadata shared by Artist Hero producers and consumers."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Literal

from crate.artist_hero_artwork import (
    ARTIST_HERO_RENDER_VERSION,
    DESKTOP_HERO_SIZE,
    MOBILE_HERO_SIZE,
    get_artist_hero_artwork_bounds,
)
from crate.utils import coerce_int

ARTIST_HERO_CONTRACT_VERSION = 1
ARTIST_HERO_PROFILE_CONTRACT_VERSION = 2
ARTIST_HERO_RENDER_MANIFEST_VERSION = 1
SUPPORTED_ARTIST_HERO_RENDER_VERSIONS = frozenset({ARTIST_HERO_RENDER_VERSION})


def _canonical_json(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def artist_hero_recipe_hash(recipe: Mapping[str, object]) -> str:
    """Return a stable short hash for a normalized recipe."""

    return hashlib.sha256(_canonical_json(dict(recipe))).hexdigest()[:16]


def artist_hero_render_version_is_supported(render_version: object) -> bool:
    return str(render_version or "") in SUPPORTED_ARTIST_HERO_RENDER_VERSIONS


def _safe_relative_path(value: object) -> str | None:
    path = str(value or "").strip()
    if not path or path.startswith("/") or ".." in path.split("/"):
        return None
    return path


def _validated_render_manifest(profile: Mapping[str, object]) -> dict | None:
    raw = profile.get("render_manifest")
    if not isinstance(raw, Mapping):
        return None
    if raw.get("manifest_version") != ARTIST_HERO_RENDER_MANIFEST_VERSION:
        return None
    editorial_revision = str(raw.get("editorial_revision") or "").strip()
    artifacts = raw.get("artifacts")
    if not editorial_revision or not isinstance(artifacts, Mapping):
        return None

    normalized: dict[str, object] = {
        "manifest_version": ARTIST_HERO_RENDER_MANIFEST_VERSION,
        "editorial_revision": editorial_revision,
        "artifacts": {},
    }
    normalized_artifacts: dict[str, dict[str, str]] = {}
    for composition in ("desktop", "mobile"):
        artifact = artifacts.get(composition)
        if not isinstance(artifact, Mapping):
            continue
        required = {
            "renderer_version": str(artifact.get("renderer_version") or "").strip(),
            "render_revision": str(artifact.get("render_revision") or "").strip(),
            "source_fingerprint": str(artifact.get("source_fingerprint") or "").strip(),
            "recipe_hash": str(artifact.get("recipe_hash") or "").strip(),
        }
        relative_path = _safe_relative_path(artifact.get("relative_path"))
        if not relative_path or any(not value for value in required.values()):
            continue
        normalized_artifacts[composition] = {
            **required,
            "relative_path": relative_path,
        }
    if not normalized_artifacts:
        return None
    normalized["artifacts"] = normalized_artifacts
    return normalized


def artist_hero_composition_view(
    *,
    artist_id: int,
    composition: Literal["desktop", "mobile"],
    recipe: Mapping[str, object],
    source_size: tuple[int, int],
    render_revision: str,
    recipe_hash: str | None = None,
) -> dict[str, object]:
    size = DESKTOP_HERO_SIZE if composition == "desktop" else MOBILE_HERO_SIZE
    bounds = get_artist_hero_artwork_bounds(source_size, recipe, size)
    asset_path = (
        f"/api/artists/{artist_id}/hero?composition={composition}"
        f"&size={size[0]}&v={render_revision}"
    )
    return {
        "schema_version": ARTIST_HERO_CONTRACT_VERSION,
        "composition": composition,
        "render_revision": render_revision,
        "recipe_hash": recipe_hash or artist_hero_recipe_hash(recipe),
        "width": size[0],
        "height": size[1],
        "bounds": bounds,
        "asset_path": asset_path,
    }


def artist_hero_composition_views(
    *,
    artist_id: int,
    desktop_recipe: Mapping[str, object],
    mobile_recipe: Mapping[str, object],
    desktop_source_size: tuple[int, int],
    mobile_source_size: tuple[int, int],
    render_revision: str,
) -> dict[str, dict[str, object]]:
    return {
        "desktop": artist_hero_composition_view(
            artist_id=artist_id,
            composition="desktop",
            recipe=desktop_recipe,
            source_size=desktop_source_size,
            render_revision=render_revision,
        ),
        "mobile": artist_hero_composition_view(
            artist_id=artist_id,
            composition="mobile",
            recipe=mobile_recipe,
            source_size=mobile_source_size,
            render_revision=render_revision,
        ),
    }


def artist_hero_profile_compositions(
    *,
    artist_id: int,
    profile: Mapping[str, object],
    artifacts: Mapping[str, Mapping[str, str]] | None = None,
) -> dict[str, dict[str, object]]:
    """Build canonical views from the persisted profile row."""

    generic_size = (
        coerce_int(profile.get("source_width")),
        coerce_int(profile.get("source_height")),
    )
    desktop_size = (
        coerce_int(profile.get("desktop_source_width") or generic_size[0]),
        coerce_int(profile.get("desktop_source_height") or generic_size[1]),
    )
    mobile_size = (
        coerce_int(profile.get("mobile_source_width") or generic_size[0]),
        coerce_int(profile.get("mobile_source_height") or generic_size[1]),
    )
    revision = str(profile.get("revision") or "")
    desktop_recipe = profile.get("desktop_recipe")
    mobile_recipe = profile.get("mobile_recipe")
    if not revision:
        return {}

    compositions: dict[str, dict[str, object]] = {}
    for composition in ("desktop", "mobile"):
        if artifacts is not None and composition not in artifacts:
            continue
        recipe = desktop_recipe if composition == "desktop" else mobile_recipe
        source_size = desktop_size if composition == "desktop" else mobile_size
        # The flags were added after the original profile contract. Treat a
        # missing flag as enabled so existing rows remain compatible.
        if profile.get(f"{composition}_enabled", True) is False:
            continue
        if (
            not isinstance(recipe, Mapping)
            or source_size[0] <= 0
            or source_size[1] <= 0
        ):
            continue
        compositions[composition] = artist_hero_composition_view(
            artist_id=artist_id,
            composition=composition,
            recipe=recipe,
            source_size=source_size,
            render_revision=(
                artifacts.get(composition, {}).get("render_revision", revision)
                if artifacts
                else revision
            ),
            recipe_hash=(
                artifacts.get(composition, {}).get("recipe_hash") if artifacts else None
            ),
        )
    return compositions


def artist_hero_profile_ready_compositions(
    profile: Mapping[str, object],
) -> tuple[str, ...]:
    """Return canonical compositions that are eligible for Featured Artist."""

    if profile.get("provenance") != "manual":
        return ()
    if profile.get("review_status") != "approved":
        return ()
    manifest = _validated_render_manifest(profile)
    if manifest is None:
        if not any(
            str(profile.get("revision") or "").startswith(f"{version}:")
            for version in SUPPORTED_ARTIST_HERO_RENDER_VERSIONS
        ):
            return ()
        artifacts: Mapping[str, Mapping[str, str]] = {}
    else:
        artifacts = manifest["artifacts"]

    generic_size = (
        coerce_int(profile.get("source_width")),
        coerce_int(profile.get("source_height")),
    )
    ready: list[str] = []
    for composition in ("desktop", "mobile"):
        artifact = artifacts.get(composition)
        if manifest is not None and (
            artifact is None
            or not artist_hero_render_version_is_supported(
                artifact.get("renderer_version")
            )
        ):
            continue
        if profile.get(f"{composition}_enabled", True) is False:
            continue
        width = coerce_int(
            profile.get(f"{composition}_source_width") or generic_size[0]
        )
        height = coerce_int(
            profile.get(f"{composition}_source_height") or generic_size[1]
        )
        if (
            width > 0
            and height > 0
            and isinstance(profile.get(f"{composition}_recipe"), Mapping)
        ):
            ready.append(composition)
    return tuple(ready)


def artist_hero_profile_composition_is_supported(
    profile: Mapping[str, object], composition: str
) -> bool:
    """Return whether delivery may serve the selected composition."""

    if composition not in {"desktop", "mobile"}:
        return False
    manifest = _validated_render_manifest(profile)
    if manifest is not None:
        artifact = manifest["artifacts"].get(composition)
        return bool(
            artifact
            and artist_hero_render_version_is_supported(
                artifact.get("renderer_version")
            )
        )
    revision = str(profile.get("revision") or "")
    return any(
        revision.startswith(f"{version}:")
        for version in SUPPORTED_ARTIST_HERO_RENDER_VERSIONS
    )


def artist_hero_profile_contract(
    *, artist_id: int, profile: Mapping[str, object]
) -> dict[str, object]:
    manifest = _validated_render_manifest(profile)
    artifacts = manifest["artifacts"] if manifest is not None else None
    compositions = artist_hero_profile_compositions(
        artist_id=artist_id,
        profile=profile,
        artifacts=artifacts,
    )
    if manifest is None:
        return {
            "schema_version": ARTIST_HERO_CONTRACT_VERSION,
            "render_version": ARTIST_HERO_RENDER_VERSION,
            "compositions": compositions,
        }

    public_artifacts: dict[str, dict[str, str]] = {}
    for composition, artifact in artifacts.items():
        size = DESKTOP_HERO_SIZE if composition == "desktop" else MOBILE_HERO_SIZE
        public_artifacts[composition] = {
            "renderer_version": artifact["renderer_version"],
            "render_revision": artifact["render_revision"],
            "source_fingerprint": artifact["source_fingerprint"],
            "recipe_hash": artifact["recipe_hash"],
            "asset_path": (
                f"/api/artists/{artist_id}/hero?composition={composition}"
                f"&size={size[0]}&v={artifact['render_revision']}"
            ),
        }
    render_versions = {artifact["renderer_version"] for artifact in artifacts.values()}
    render_version = (
        next(iter(render_versions)) if len(render_versions) == 1 else "mixed"
    )
    return {
        "schema_version": ARTIST_HERO_PROFILE_CONTRACT_VERSION,
        "render_version": render_version,
        "render_manifest": {
            "manifest_version": manifest["manifest_version"],
            "editorial_revision": manifest["editorial_revision"],
            "artifacts": public_artifacts,
        },
        "compositions": compositions,
    }
