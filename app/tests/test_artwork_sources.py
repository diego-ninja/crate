from __future__ import annotations


def test_revision_scoped_artist_hero_source_does_not_fall_back_to_legacy_file(
    monkeypatch, tmp_path
):
    from PIL import Image

    from crate import artwork_sources
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        publish_artist_hero_artifact,
    )
    from crate.artwork_variants import ArtworkAsset

    monkeypatch.setenv("CACHE_DIR", str(tmp_path))
    artist_dir = tmp_path / "Artist"
    artist_dir.mkdir()
    (artist_dir / "artist-hero-desktop.webp").write_bytes(b"legacy")
    monkeypatch.setattr(
        artwork_sources,
        "get_library_artist_by_entity_uid",
        lambda _uid: {"entity_uid": "artist-entity", "name": "Artist"},
    )
    monkeypatch.setattr(artwork_sources, "library_path", lambda: tmp_path)
    monkeypatch.setattr(
        artwork_sources,
        "resolve_artist_dir",
        lambda *_args, **_kwargs: artist_dir,
    )
    identity = ArtistHeroArtifactIdentity(
        "artist-entity", "desktop", "renderer:revision-a"
    )
    publish_artist_hero_artifact(
        identity,
        Image.new("RGB", (16, 8), color="red"),
        source_fingerprint="sha256:source-a",
        recipe_hash="recipe-a",
        renderer_version="renderer",
    )

    source = artwork_sources.resolve_artwork_source(
        ArtworkAsset("artist-hero", identity.asset_key)
    )

    assert source is not None
    assert source.content != b"legacy"
    assert source.origin == "revision-artifact"


def test_album_source_prefers_canonical_cover(monkeypatch, tmp_path):
    from crate import artwork_sources
    from crate.artwork_variants import ArtworkAsset

    album_dir = tmp_path / "Artist" / "Album"
    album_dir.mkdir(parents=True)
    (album_dir / "cover.jpg").write_bytes(b"jpeg-cover")
    monkeypatch.setattr(artwork_sources, "library_path", lambda: tmp_path)
    monkeypatch.setattr(
        artwork_sources,
        "get_library_album_by_entity_uid",
        lambda _uid: {"entity_uid": "album-entity", "artist": "Artist"},
    )
    monkeypatch.setattr(
        artwork_sources, "get_library_artist", lambda _name: {"name": "Artist"}
    )
    monkeypatch.setattr(
        artwork_sources,
        "resolve_album_dir",
        lambda *_args, **_kwargs: album_dir,
    )

    source = artwork_sources.resolve_artwork_source(
        ArtworkAsset("album-cover", "album-entity")
    )

    assert source is not None
    assert source.content == b"jpeg-cover"
    assert source.media_type == "image/jpeg"
    assert source.origin == "local-file"


def test_album_source_uses_embedded_artwork_in_worker(monkeypatch, tmp_path):
    from crate import artwork_sources
    from crate.artwork_variants import ArtworkAsset

    album_dir = tmp_path / "Artist" / "Album"
    album_dir.mkdir(parents=True)
    track = album_dir / "01.flac"
    track.write_bytes(b"audio")
    monkeypatch.setattr(artwork_sources, "library_path", lambda: tmp_path)
    monkeypatch.setattr(
        artwork_sources,
        "get_library_album_by_entity_uid",
        lambda _uid: {"entity_uid": "album-entity", "artist": "Artist"},
    )
    monkeypatch.setattr(
        artwork_sources, "get_library_artist", lambda _name: {"name": "Artist"}
    )
    monkeypatch.setattr(
        artwork_sources,
        "resolve_album_dir",
        lambda *_args, **_kwargs: album_dir,
    )
    monkeypatch.setattr(artwork_sources, "extensions", lambda: [".flac"])
    monkeypatch.setattr(artwork_sources, "get_audio_files", lambda *_args: [track])
    monkeypatch.setattr(
        artwork_sources,
        "extract_embedded_artwork",
        lambda _path: (b"embedded", "image/png"),
    )

    source = artwork_sources.resolve_artwork_source(
        ArtworkAsset("album-cover", "album-entity")
    )

    assert source is not None
    assert source.content == b"embedded"
    assert source.media_type == "image/png"
    assert source.origin == "embedded"


def test_artist_sources_keep_photo_and_background_distinct(monkeypatch, tmp_path):
    from crate import artwork_sources
    from crate.artwork_variants import ArtworkAsset

    artist_dir = tmp_path / "Artist"
    artist_dir.mkdir()
    (artist_dir / "artist.jpg").write_bytes(b"photo")
    (artist_dir / "background.jpg").write_bytes(b"background")
    monkeypatch.setattr(artwork_sources, "library_path", lambda: tmp_path)
    monkeypatch.setattr(
        artwork_sources,
        "get_library_artist_by_entity_uid",
        lambda _uid: {"entity_uid": "artist-entity", "name": "Artist"},
    )
    monkeypatch.setattr(
        artwork_sources,
        "resolve_artist_dir",
        lambda *_args, **_kwargs: artist_dir,
    )

    photo = artwork_sources.resolve_artwork_source(
        ArtworkAsset("artist-photo", "artist-entity")
    )
    background = artwork_sources.resolve_artwork_source(
        ArtworkAsset("artist-background", "artist-entity")
    )

    assert photo is not None and photo.content == b"photo"
    assert background is not None and background.content == b"background"


def test_source_resolver_returns_none_for_unknown_entity(monkeypatch):
    from crate import artwork_sources
    from crate.artwork_variants import ArtworkAsset

    monkeypatch.setattr(
        artwork_sources, "get_library_album_by_entity_uid", lambda _uid: None
    )

    assert (
        artwork_sources.resolve_artwork_source(
            ArtworkAsset("album-cover", "missing-entity")
        )
        is None
    )


def test_genre_release_and_external_sources_use_durable_local_files(
    monkeypatch, tmp_path
):
    from crate import artwork_sources
    from crate.artwork_variants import ArtworkAsset

    genre = tmp_path / "genre.jpg"
    release = tmp_path / "release.jpg"
    external = tmp_path / "external.webp"
    genre.write_bytes(b"genre")
    release.write_bytes(b"release")
    external.write_bytes(b"external")
    monkeypatch.setattr(
        artwork_sources, "get_genre_taxonomy_cover_path", lambda _slug: "genre.jpg"
    )
    monkeypatch.setattr(artwork_sources, "genre_cover_abspath", lambda _path: genre)
    monkeypatch.setattr(
        artwork_sources, "release_cover_abspath", lambda _release_id: release
    )
    monkeypatch.setattr(
        artwork_sources,
        "external_artist_artwork_path_from_key",
        lambda _key: external,
    )

    assert (
        artwork_sources.resolve_artwork_source(
            ArtworkAsset("genre-cover", "post-hardcore")
        ).content
        == b"genre"
    )
    assert (
        artwork_sources.resolve_artwork_source(
            ArtworkAsset("release-cover", "42")
        ).content
        == b"release"
    )
    assert (
        artwork_sources.resolve_artwork_source(
            ArtworkAsset("external-artist", "a" * 64)
        ).content
        == b"external"
    )


def test_missing_artist_background_is_resolved_by_worker_provider(
    monkeypatch, tmp_path
):
    from crate import artwork_sources
    from crate.artwork_variants import ArtworkAsset

    artist_dir = tmp_path / "Artist"
    artist_dir.mkdir()
    monkeypatch.setattr(artwork_sources, "library_path", lambda: tmp_path)
    monkeypatch.setattr(
        artwork_sources,
        "get_library_artist_by_entity_uid",
        lambda _uid: {"entity_uid": "artist-entity", "name": "Artist"},
    )
    monkeypatch.setattr(
        artwork_sources,
        "resolve_artist_dir",
        lambda *_args, **_kwargs: artist_dir,
    )
    monkeypatch.setattr(
        artwork_sources,
        "_fetch_artist_background_provider",
        lambda _name: (b"provider-background", "image/jpeg"),
    )

    source = artwork_sources.resolve_artwork_source(
        ArtworkAsset("artist-background", "artist-entity")
    )

    assert source is not None
    assert source.content == b"provider-background"
    assert source.origin == "provider"


def test_bulk_source_resolution_skips_remote_artist_provider(monkeypatch, tmp_path):
    from crate import artwork_sources
    from crate.artwork_variants import ArtworkAsset

    artist_dir = tmp_path / "Artist"
    artist_dir.mkdir()
    monkeypatch.setattr(artwork_sources, "library_path", lambda: tmp_path)
    monkeypatch.setattr(
        artwork_sources,
        "get_library_artist_by_entity_uid",
        lambda _uid: {"entity_uid": "artist-entity", "name": "Artist"},
    )
    monkeypatch.setattr(
        artwork_sources,
        "resolve_artist_dir",
        lambda *_args, **_kwargs: artist_dir,
    )
    monkeypatch.setattr(
        artwork_sources,
        "_fetch_artist_photo_provider",
        lambda _name: (_ for _ in ()).throw(
            AssertionError("backfill must not contact artwork providers")
        ),
    )

    assert (
        artwork_sources.resolve_artwork_source(
            ArtworkAsset("artist-photo", "artist-entity"), allow_provider=False
        )
        is None
    )


def test_file_source_rejects_oversized_payload_before_read(monkeypatch, tmp_path):
    from crate import artwork_sources

    source_path = tmp_path / "large.jpg"
    source_path.write_bytes(b"x")
    monkeypatch.setattr(artwork_sources, "_MAX_SOURCE_BYTES", 0)
    monkeypatch.setattr(
        type(source_path),
        "read_bytes",
        lambda _self: (_ for _ in ()).throw(
            AssertionError("oversized artwork must not be read")
        ),
    )

    assert artwork_sources._file_source(source_path) is None


def test_source_resolver_rejects_oversized_embedded_or_provider_payloads(monkeypatch):
    from crate import artwork_sources
    from crate.artwork_variants import ArtworkAsset

    monkeypatch.setattr(artwork_sources, "_MAX_SOURCE_BYTES", 4)
    monkeypatch.setattr(
        artwork_sources,
        "_album_source",
        lambda _asset: artwork_sources.ArtworkSource(
            b"oversized", "image/png", "embedded"
        ),
    )

    assert (
        artwork_sources.resolve_artwork_source(
            ArtworkAsset("album-cover", "album-entity")
        )
        is None
    )
