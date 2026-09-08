from __future__ import annotations


def test_retention_keeps_active_and_one_previous_revision_per_composition():
    from crate.artist_hero_retention import retained_artist_hero_revisions

    history = [
        {
            "composition": "desktop",
            "render_revision": "desktop-newest",
            "created_at": "2026-09-08T12:00:00+00:00",
        },
        {
            "composition": "desktop",
            "render_revision": "desktop-previous",
            "created_at": "2026-09-08T11:00:00+00:00",
        },
        {
            "composition": "desktop",
            "render_revision": "desktop-active",
            "created_at": "2026-09-08T10:00:00+00:00",
        },
        {
            "composition": "mobile",
            "render_revision": "mobile-active",
            "created_at": "2026-09-08T10:00:00+00:00",
        },
        {
            "composition": "mobile",
            "render_revision": "mobile-old",
            "created_at": "2026-09-07T10:00:00+00:00",
        },
    ]

    retained = retained_artist_hero_revisions(
        history,
        active_revisions={
            "desktop": "desktop-active",
            "mobile": "mobile-active",
        },
    )

    assert retained == {
        ("desktop", "desktop-active"),
        ("desktop", "desktop-newest"),
        ("mobile", "mobile-active"),
        ("mobile", "mobile-old"),
    }


def test_retention_plans_only_known_stale_publication_directories(tmp_path):
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        artist_hero_artifact_root,
    )
    from crate.artist_hero_retention import plan_artist_hero_publication_cleanup

    stale = ArtistHeroArtifactIdentity("artist-1", "desktop", "desktop-stale")
    current = ArtistHeroArtifactIdentity("artist-1", "desktop", "desktop-current")
    artist_hero_artifact_root(stale, root=tmp_path).mkdir(parents=True)
    artist_hero_artifact_root(current, root=tmp_path).mkdir(parents=True)
    (
        tmp_path / "artist-hero-publications" / "v1" / "artist-1" / "desktop" / "orphan"
    ).mkdir(parents=True)

    paths = plan_artist_hero_publication_cleanup(
        artist_entity_uid="artist-1",
        history=[
            {
                "composition": "desktop",
                "render_revision": "desktop-current",
                "created_at": "2026-09-08T12:00:00+00:00",
            },
            {
                "composition": "desktop",
                "render_revision": "desktop-old",
                "created_at": "2026-09-07T12:00:00+00:00",
            },
            {
                "composition": "desktop",
                "render_revision": "desktop-stale",
                "created_at": "2026-09-06T12:00:00+00:00",
            },
        ],
        active_revisions={"desktop": "desktop-current"},
        root=tmp_path,
    )

    assert paths == [
        artist_hero_artifact_root(stale, root=tmp_path),
    ]


def test_manifest_retention_keeps_active_and_previous_complete_bundles():
    from crate.artist_hero_retention import (
        retained_artist_hero_revisions_from_manifests,
    )

    def row(manifest_id: str, revision: str, created_at: str) -> dict:
        return {
            "manifest_id": manifest_id,
            "created_at": created_at,
            "manifest": {
                "artifacts": {
                    "desktop": {"render_revision": revision},
                    "mobile": {"render_revision": revision},
                }
            },
        }

    retained = retained_artist_hero_revisions_from_manifests(
        [
            row("manifest-c", "artifact-c", "2026-09-08T12:00:00+00:00"),
            row("manifest-b", "artifact-b", "2026-09-08T11:00:00+00:00"),
            row("manifest-a", "artifact-a", "2026-09-08T10:00:00+00:00"),
        ],
        active_manifest_id="manifest-c",
        keep_manifest_count=2,
    )

    assert retained == {
        ("desktop", "artifact-c"),
        ("desktop", "artifact-b"),
        ("mobile", "artifact-c"),
        ("mobile", "artifact-b"),
    }
