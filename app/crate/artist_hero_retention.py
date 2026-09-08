"""Retention planning for immutable Artist Hero publications."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path

from crate.artist_hero_publication import (
    ArtistHeroArtifactIdentity,
    artist_hero_artifact_root,
)


def retained_artist_hero_revisions(
    history: Sequence[Mapping[str, object]],
    active_revisions: Mapping[str, str],
    *,
    keep_per_composition: int = 2,
) -> set[tuple[str, str]]:
    """Keep the active revision and the newest previous revision per surface."""

    keep_count = max(1, int(keep_per_composition))
    grouped: dict[str, list[Mapping[str, object]]] = {"desktop": [], "mobile": []}
    for row in history:
        composition = str(row.get("composition") or "")
        revision = str(row.get("render_revision") or "")
        if composition in grouped and revision:
            grouped[composition].append(row)

    retained: set[tuple[str, str]] = set()
    for composition, rows in grouped.items():
        active_revision = str(active_revisions.get(composition) or "")
        if active_revision:
            retained.add((composition, active_revision))
        ordered = sorted(
            rows,
            key=lambda row: str(row.get("created_at") or ""),
            reverse=True,
        )
        for row in ordered:
            revision = str(row.get("render_revision") or "")
            if len([item for item in retained if item[0] == composition]) >= keep_count:
                break
            retained.add((composition, revision))
    return retained


def plan_artist_hero_publication_cleanup(
    *,
    artist_entity_uid: str,
    history: Sequence[Mapping[str, object]],
    active_revisions: Mapping[str, str],
    root: Path,
    keep_per_composition: int = 2,
) -> list[Path]:
    """Return only known stale publication directories, never unknown orphans."""

    retained = retained_artist_hero_revisions(
        history,
        active_revisions,
        keep_per_composition=keep_per_composition,
    )
    stale: list[Path] = []
    for row in history:
        composition = str(row.get("composition") or "")
        revision = str(row.get("render_revision") or "")
        if (composition, revision) in retained:
            continue
        try:
            identity = ArtistHeroArtifactIdentity(
                artist_entity_uid=artist_entity_uid,
                composition=composition,
                render_revision=revision,
            )
        except ValueError:
            continue
        path = artist_hero_artifact_root(identity, root=root)
        if path.is_dir():
            stale.append(path)
    return sorted(stale)


__all__ = [
    "plan_artist_hero_publication_cleanup",
    "retained_artist_hero_revisions",
]
