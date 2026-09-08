"""Planning helpers for the resumable artist-hero canary migration."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path


ARTIST_HERO_COMPOSITIONS = ("desktop", "mobile")


@dataclass(frozen=True)
class ArtistHeroMigrationPlan:
    """Validated inputs for one migration target, without side effects."""

    artist_id: int | None = None
    entity_uid: str = ""
    expected_revision: str = ""
    enabled: tuple[str, ...] = ()
    source_paths: dict[str, Path] = field(default_factory=dict)
    recipes: dict[str, dict] = field(default_factory=dict)
    skip_reason: str | None = None


def _enabled_compositions(profile: Mapping[str, object]) -> tuple[str, ...]:
    return tuple(
        composition
        for composition in ARTIST_HERO_COMPOSITIONS
        if profile.get(f"{composition}_enabled", True) is not False
    )


def _manifest_covers_enabled_slots(manifest: object, enabled: tuple[str, ...]) -> bool:
    if not isinstance(manifest, Mapping):
        return False
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, Mapping):
        return False
    return all(
        isinstance(artifacts.get(composition), Mapping)
        and bool(artifacts[composition].get("relative_path"))
        for composition in enabled
    )


def plan_artist_hero_migration(
    *,
    artist_row: Mapping[str, object],
    profile: Mapping[str, object],
    artist_dir: Path,
) -> ArtistHeroMigrationPlan:
    """Validate one legacy hero without rendering or mutating anything.

    The canary intentionally requires every enabled composition before it
    returns a plan. This prevents a migration worker from publishing a
    partial desktop/mobile manifest.
    """

    artist_id_raw = artist_row.get("id")
    entity_uid = str(artist_row.get("entity_uid") or "")
    expected_revision = str(profile.get("revision") or "")
    enabled = _enabled_compositions(profile)

    def skipped(reason: str) -> ArtistHeroMigrationPlan:
        return ArtistHeroMigrationPlan(
            artist_id=int(artist_id_raw) if artist_id_raw is not None else None,
            entity_uid=entity_uid,
            expected_revision=expected_revision,
            enabled=enabled,
            skip_reason=reason,
        )

    if artist_id_raw is None:
        return skipped("missing-artist-id")
    if not entity_uid:
        return skipped("missing-entity-uid")
    if not expected_revision:
        return skipped("missing-revision")
    if not enabled:
        return skipped("no-enabled-compositions")
    if _manifest_covers_enabled_slots(profile.get("render_manifest"), enabled):
        return skipped("already-published")

    source_paths: dict[str, Path] = {}
    recipes: dict[str, dict] = {}
    shared_source = artist_dir / "artist-hero-source.jpg"
    for composition in enabled:
        recipe = profile.get(f"{composition}_recipe")
        if not isinstance(recipe, Mapping) or not recipe:
            return skipped(f"missing-recipe:{composition}")

        specific_source = artist_dir / f"artist-hero-source-{composition}.jpg"
        if specific_source.is_file():
            source_paths[composition] = specific_source
        elif shared_source.is_file():
            source_paths[composition] = shared_source
        else:
            return skipped(f"missing-source:{composition}")
        recipes[composition] = dict(recipe)

    return ArtistHeroMigrationPlan(
        artist_id=int(artist_id_raw),
        entity_uid=entity_uid,
        expected_revision=expected_revision,
        enabled=enabled,
        source_paths=source_paths,
        recipes=recipes,
    )


def migration_task_dedup_key(artist_id: int, expected_revision: str) -> str:
    """Scope target deduplication to the editorial revision being migrated."""

    return f"migrate-artist-hero:{int(artist_id)}:{expected_revision}"
