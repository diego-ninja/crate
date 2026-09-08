from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image


def _image() -> Image.Image:
    return Image.new("RGBA", (32, 16), (20, 120, 160, 220))


def test_artist_hero_artifact_identity_is_revision_scoped():
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        artist_hero_artifact_asset,
        artist_hero_artifact_root,
    )

    first = ArtistHeroArtifactIdentity(
        artist_entity_uid="artist-1",
        composition="desktop",
        render_revision="cover-fit-v5:revision-a",
    )
    second = ArtistHeroArtifactIdentity(
        artist_entity_uid="artist-1",
        composition="desktop",
        render_revision="cover-fit-v5:revision-b",
    )

    assert (
        artist_hero_artifact_asset(first).entity_key
        != artist_hero_artifact_asset(second).entity_key
    )
    assert artist_hero_artifact_root(
        first, root=Path("/tmp")
    ) != artist_hero_artifact_root(second, root=Path("/tmp"))


@pytest.mark.parametrize(
    ("artist_entity_uid", "composition", "render_revision"),
    [
        ("../artist", "desktop", "revision-a"),
        ("artist-1", "desktop/mobile", "revision-a"),
        ("artist-1", "desktop", "../revision-a"),
        ("artist-1", "desktop", "revision-a/other"),
        ("artist-1", "desktop", ""),
    ],
)
def test_artist_hero_artifact_identity_rejects_path_unsafe_values(
    artist_entity_uid: str, composition: str, render_revision: str
):
    from crate.artist_hero_publication import ArtistHeroArtifactIdentity

    with pytest.raises(ValueError):
        ArtistHeroArtifactIdentity(
            artist_entity_uid=artist_entity_uid,
            composition=composition,
            render_revision=render_revision,
        )


def test_publish_artist_hero_artifact_writes_durable_sidecar_and_is_idempotent(
    tmp_path,
):
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        artist_hero_artifact_manifest_path,
        artist_hero_artifact_source_path,
        publish_artist_hero_artifact,
    )

    identity = ArtistHeroArtifactIdentity(
        artist_entity_uid="artist-1",
        composition="desktop",
        render_revision="cover-fit-v5:revision-a",
    )
    first = publish_artist_hero_artifact(
        identity,
        _image(),
        source_fingerprint="sha256:source-a",
        recipe_hash="recipe-a",
        renderer_version="cover-fit-v5-neutral-alpha",
        root=tmp_path,
    )
    second = publish_artist_hero_artifact(
        identity,
        _image(),
        source_fingerprint="sha256:source-a",
        recipe_hash="recipe-a",
        renderer_version="cover-fit-v5-neutral-alpha",
        root=tmp_path,
    )

    assert first == second
    artifact_path = artist_hero_artifact_source_path(identity, root=tmp_path)
    manifest_path = artist_hero_artifact_manifest_path(identity, root=tmp_path)
    assert artifact_path.is_file()
    assert manifest_path.is_file()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["render_revision"] == identity.render_revision
    assert manifest["relative_path"].endswith(
        "artist-hero-publications/v1/artist-1/desktop/cover-fit-v5:revision-a/artifact.webp"
    )
    with Image.open(BytesIO(artifact_path.read_bytes())) as rendered:
        assert rendered.mode == "RGBA"
        assert rendered.getpixel((0, 0))[3] == 220


def test_publish_artist_hero_artifact_rejects_conflicting_retry(tmp_path):
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        ArtistHeroPublicationConflict,
        publish_artist_hero_artifact,
    )

    identity = ArtistHeroArtifactIdentity("artist-1", "mobile", "revision-a")
    publish_artist_hero_artifact(
        identity,
        _image(),
        source_fingerprint="sha256:source-a",
        recipe_hash="recipe-a",
        renderer_version="renderer-a",
        root=tmp_path,
    )

    with pytest.raises(ArtistHeroPublicationConflict):
        publish_artist_hero_artifact(
            identity,
            _image(),
            source_fingerprint="sha256:source-b",
            recipe_hash="recipe-a",
            renderer_version="renderer-a",
            root=tmp_path,
        )
