from __future__ import annotations

from types import SimpleNamespace


def _record_original(records, path, kwargs):
    response = SimpleNamespace(status_code=200, headers={})
    records.append((path, kwargs, response))
    return response


def test_album_id_and_entity_routes_use_same_canonical_asset(monkeypatch, tmp_path):
    from crate.api import browse_album

    album_dir = tmp_path / "Artist" / "Album"
    album_dir.mkdir(parents=True)
    cover = album_dir / "cover.jpg"
    cover.write_bytes(b"cover")
    album = {
        "id": 7,
        "entity_uid": "album-entity",
        "artist": "Artist",
        "name": "Album",
    }
    delivered = []
    monkeypatch.setattr(browse_album, "get_library_album_by_id", lambda _id: album)
    monkeypatch.setattr(
        browse_album, "get_library_album_by_entity_uid", lambda _uid: album
    )
    monkeypatch.setattr(browse_album, "get_library_artist", lambda _name: {})
    monkeypatch.setattr(browse_album, "library_path", lambda: tmp_path)
    monkeypatch.setattr(
        browse_album, "resolve_album_dir", lambda *_args, **_kwargs: album_dir
    )
    monkeypatch.setattr(
        browse_album,
        "deliver_artwork",
        lambda asset, **kwargs: (
            delivered.append((asset, kwargs)) or SimpleNamespace(status_code=200)
        ),
    )

    browse_album.api_cover_by_id(7, size=320, image_format="webp")
    browse_album.api_cover_by_entity_uid("album-entity", size=320, image_format="webp")

    assert [asset.entity_key for asset, _kwargs in delivered] == [
        "album-entity",
        "album-entity",
    ]
    assert all(asset.kind == "album-cover" for asset, _kwargs in delivered)
    assert all(kwargs["local_original"] == cover for _asset, kwargs in delivered)
    assert all(kwargs["requested_size"] == 320 for _asset, kwargs in delivered)


def test_artist_id_and_entity_routes_use_same_canonical_asset(monkeypatch, tmp_path):
    from crate.api import browse_artist

    artist_dir = tmp_path / "Artist"
    artist_dir.mkdir()
    photo = artist_dir / "artist.jpg"
    photo.write_bytes(b"photo")
    artist = {
        "id": 5,
        "entity_uid": "artist-entity",
        "name": "Artist",
    }
    delivered = []
    monkeypatch.setattr(browse_artist, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(browse_artist, "artist_name_from_id", lambda _id: "Artist")
    monkeypatch.setattr(browse_artist, "get_library_artist", lambda _name: artist)
    monkeypatch.setattr(browse_artist, "library_path", lambda: tmp_path)
    monkeypatch.setattr(
        browse_artist, "get_library_artist_by_entity_uid", lambda _uid: artist
    )
    monkeypatch.setattr(
        browse_artist,
        "resolve_artist_dir",
        lambda *_args, **_kwargs: artist_dir,
    )
    monkeypatch.setattr(
        browse_artist,
        "deliver_artwork",
        lambda asset, **kwargs: (
            delivered.append((asset, kwargs)) or SimpleNamespace(status_code=200)
        ),
    )

    browse_artist.api_artist_photo_by_id(SimpleNamespace(), 5, size=256)
    browse_artist.api_artist_photo_by_entity_uid(
        SimpleNamespace(), "artist-entity", size=256
    )
    browse_artist.api_artist_background_by_id(SimpleNamespace(), 5, size=512)
    browse_artist.api_artist_background_by_entity_uid(
        SimpleNamespace(), "artist-entity", size=512
    )

    assert [asset.entity_key for asset, _kwargs in delivered] == [
        "artist-entity",
        "artist-entity",
        "artist-entity",
        "artist-entity",
    ]
    assert [asset.kind for asset, _kwargs in delivered] == [
        "artist-photo",
        "artist-photo",
        "artist-background",
        "artist-background",
    ]
    assert all(kwargs["local_original"] == photo for _asset, kwargs in delivered)
    assert all(kwargs["cache_visibility"] == "private" for _asset, kwargs in delivered)


def test_artist_hero_routes_select_composition_and_fallback(monkeypatch, tmp_path):
    from crate.api import browse_artist
    from crate.artist_hero_artwork import ARTIST_HERO_RENDER_VERSION

    artist_dir = tmp_path / "Artist"
    artist_dir.mkdir()
    mobile = artist_dir / "artist-hero-mobile.webp"
    mobile.write_bytes(b"mobile")
    artist = {"id": 5, "entity_uid": "artist-entity", "name": "Artist"}
    current_revision = f"{ARTIST_HERO_RENDER_VERSION}:fixture"
    delivered = []
    fallbacks = []
    queued = []
    monkeypatch.setattr(browse_artist, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(browse_artist, "artist_name_from_id", lambda _id: "Artist")
    monkeypatch.setattr(browse_artist, "get_library_artist", lambda _name: artist)
    monkeypatch.setattr(
        browse_artist,
        "get_artist_hero_artwork",
        lambda _artist_id: {
            "review_status": "approved",
            "revision": current_revision,
        },
    )
    monkeypatch.setattr(browse_artist, "library_path", lambda: tmp_path)
    monkeypatch.setattr(
        browse_artist,
        "resolve_artist_dir",
        lambda *_args, **_kwargs: artist_dir,
    )
    monkeypatch.setattr(
        browse_artist,
        "deliver_artwork",
        lambda asset, **kwargs: (
            delivered.append((asset, kwargs)) or SimpleNamespace(status_code=200)
        ),
    )
    monkeypatch.setattr(
        browse_artist,
        "create_task_dedup",
        lambda task_type, params, dedup_key: queued.append(
            (task_type, params, dedup_key)
        ),
    )
    monkeypatch.setattr(
        browse_artist,
        "api_artist_background",
        lambda *args, **kwargs: (
            fallbacks.append((args, kwargs)) or SimpleNamespace(status_code=200)
        ),
    )

    browse_artist.api_artist_hero_by_id(
        SimpleNamespace(), 5, composition="mobile", size=1024
    )
    missing_response = browse_artist.api_artist_hero_by_id(
        SimpleNamespace(), 5, composition="desktop", size=1024
    )
    monkeypatch.setattr(
        browse_artist,
        "get_artist_hero_artwork",
        lambda _artist_id: {"review_status": "rejected"},
    )
    browse_artist.api_artist_hero_by_id(
        SimpleNamespace(), 5, composition="mobile", size=1024
    )

    assert delivered[0][0].kind == "artist-hero"
    assert delivered[0][0].entity_key == "artist-entity:mobile"
    assert delivered[0][1]["local_original"] == mobile
    assert delivered[0][1]["requested_size"] == 1024
    assert missing_response.status_code == 503
    assert missing_response.headers["X-Crate-Artwork"] == "hero-pending"
    assert len(fallbacks) == 1
    assert queued == [
        (
            "recompose_artist_hero",
            {"artist": "Artist"},
            "recompose-artist-hero:5",
        )
    ]


def test_artist_hero_canonical_size_serves_generated_original(monkeypatch, tmp_path):
    from crate.api import browse_artist
    from crate.artist_hero_artwork import ARTIST_HERO_RENDER_VERSION

    artist_dir = tmp_path / "Artist"
    artist_dir.mkdir()
    desktop = artist_dir / "artist-hero-desktop.webp"
    mobile = artist_dir / "artist-hero-mobile.webp"
    desktop.write_bytes(b"desktop")
    mobile.write_bytes(b"mobile")
    artist = {"id": 5, "entity_uid": "artist-entity", "name": "Artist"}
    current_revision = f"{ARTIST_HERO_RENDER_VERSION}:fixture"
    originals = []
    variants = []
    monkeypatch.setattr(browse_artist, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(browse_artist, "artist_name_from_id", lambda _id: "Artist")
    monkeypatch.setattr(browse_artist, "get_library_artist", lambda _name: artist)
    monkeypatch.setattr(
        browse_artist,
        "get_artist_hero_artwork",
        lambda _artist_id: {
            "review_status": "approved",
            "revision": current_revision,
        },
    )
    monkeypatch.setattr(browse_artist, "library_path", lambda: tmp_path)
    monkeypatch.setattr(
        browse_artist,
        "resolve_artist_dir",
        lambda *_args, **_kwargs: artist_dir,
    )
    monkeypatch.setattr(
        browse_artist,
        "deliver_original_artwork",
        lambda path, **kwargs: _record_original(originals, path, kwargs),
    )
    monkeypatch.setattr(
        browse_artist,
        "deliver_artwork",
        lambda asset, **kwargs: (
            variants.append((asset, kwargs)) or SimpleNamespace(status_code=200)
        ),
    )

    browse_artist.api_artist_hero_by_id(
        SimpleNamespace(), 5, composition="desktop", size=1480
    )
    browse_artist.api_artist_hero_by_id(
        SimpleNamespace(), 5, composition="mobile", size=1080
    )

    assert [path for path, _kwargs, _response in originals] == [desktop, mobile]
    assert variants == []
    assert all(
        kwargs["cache_control"] == "private, no-cache, must-revalidate"
        for _path, kwargs, _response in originals
    )
    assert all(
        response.headers["X-Crate-Artwork"] == "hero"
        for _path, _kwargs, response in originals
    )


def test_artist_hero_uses_revision_scoped_artifact_when_manifest_is_active(
    monkeypatch, tmp_path
):
    from PIL import Image

    from crate.api import browse_artist
    from crate.artist_hero_artwork import ARTIST_HERO_RENDER_VERSION
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        publish_artist_hero_artifact,
    )

    monkeypatch.setenv("CACHE_DIR", str(tmp_path))
    artist = {"id": 5, "entity_uid": "artist-entity", "name": "Artist"}
    identity = ArtistHeroArtifactIdentity(
        "artist-entity", "desktop", "renderer:revision-a"
    )
    publication = publish_artist_hero_artifact(
        identity,
        Image.new("RGB", (2960, 1200), color="red"),
        source_fingerprint="sha256:source-a",
        recipe_hash="recipe-a",
        renderer_version=ARTIST_HERO_RENDER_VERSION,
    )
    delivered = []
    monkeypatch.setattr(browse_artist, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(browse_artist, "artist_name_from_id", lambda _id: "Artist")
    monkeypatch.setattr(browse_artist, "get_library_artist", lambda _name: artist)
    monkeypatch.setattr(
        browse_artist,
        "get_artist_hero_artwork",
        lambda _artist_id: {
            "review_status": "approved",
            "revision": "editorial-revision-a",
            "render_manifest": {
                "manifest_version": 1,
                "editorial_revision": "editorial-revision-a",
                "artifacts": {
                    "desktop": publication.manifest,
                },
            },
        },
    )
    monkeypatch.setattr(browse_artist, "library_path", lambda: tmp_path)
    monkeypatch.setattr(
        browse_artist, "resolve_artist_dir", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        browse_artist,
        "deliver_artwork",
        lambda asset, **kwargs: (
            delivered.append((asset, kwargs))
            or SimpleNamespace(status_code=200, headers={})
        ),
    )

    response = browse_artist.api_artist_hero_by_id(
        SimpleNamespace(),
        5,
        composition="desktop",
        size=1024,
        version="renderer:revision-a",
    )

    assert response.status_code == 200
    assert delivered[0][0].entity_key == identity.asset_key
    assert delivered[0][1]["local_original"] == publication.artifact_path


def test_artist_hero_does_not_serve_current_artifact_for_unknown_version(
    monkeypatch, tmp_path
):
    from PIL import Image

    from crate.api import browse_artist
    from crate.artist_hero_artwork import ARTIST_HERO_RENDER_VERSION
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        publish_artist_hero_artifact,
    )

    monkeypatch.setenv("CACHE_DIR", str(tmp_path))
    artist = {"id": 5, "entity_uid": "artist-entity", "name": "Artist"}
    identity = ArtistHeroArtifactIdentity("artist-entity", "mobile", "revision-a")
    publication = publish_artist_hero_artifact(
        identity,
        Image.new("RGB", (2160, 2700), color="red"),
        source_fingerprint="sha256:source-a",
        recipe_hash="recipe-a",
        renderer_version=ARTIST_HERO_RENDER_VERSION,
    )
    delivered = []
    monkeypatch.setattr(browse_artist, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(browse_artist, "artist_name_from_id", lambda _id: "Artist")
    monkeypatch.setattr(browse_artist, "get_library_artist", lambda _name: artist)
    monkeypatch.setattr(
        browse_artist,
        "get_artist_hero_artwork",
        lambda _artist_id: {
            "review_status": "approved",
            "revision": "editorial-revision-a",
            "render_manifest": {
                "manifest_version": 1,
                "editorial_revision": "editorial-revision-a",
                "artifacts": {"mobile": publication.manifest},
            },
        },
    )
    monkeypatch.setattr(browse_artist, "library_path", lambda: tmp_path)
    monkeypatch.setattr(
        browse_artist, "resolve_artist_dir", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        browse_artist,
        "deliver_artwork",
        lambda asset, **kwargs: delivered.append((asset, kwargs)),
    )

    response = browse_artist.api_artist_hero_by_id(
        SimpleNamespace(),
        5,
        composition="mobile",
        size=1024,
        version="revision-old",
    )

    assert response.status_code == 404
    assert response.headers["X-Crate-Artwork"] == "hero-revision-unavailable"
    assert delivered == []


def test_artist_hero_route_recomposes_legacy_renderer_output(monkeypatch, tmp_path):
    from crate.api import browse_artist

    artist_dir = tmp_path / "Artist"
    artist_dir.mkdir()
    desktop = artist_dir / "artist-hero-desktop.webp"
    desktop.write_bytes(b"legacy-desktop")
    artist = {"id": 5, "entity_uid": "artist-entity", "name": "Artist"}
    queued = []
    monkeypatch.setattr(browse_artist, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(browse_artist, "artist_name_from_id", lambda _id: "Artist")
    monkeypatch.setattr(browse_artist, "get_library_artist", lambda _name: artist)
    monkeypatch.setattr(
        browse_artist,
        "get_artist_hero_artwork",
        lambda _artist_id: {
            "review_status": "approved",
            "revision": "legacy-renderer-revision",
        },
    )
    monkeypatch.setattr(browse_artist, "library_path", lambda: tmp_path)
    monkeypatch.setattr(
        browse_artist,
        "resolve_artist_dir",
        lambda *_args, **_kwargs: artist_dir,
    )
    monkeypatch.setattr(
        browse_artist,
        "create_task_dedup",
        lambda task_type, params, dedup_key: queued.append(
            (task_type, params, dedup_key)
        ),
    )
    monkeypatch.setattr(
        browse_artist,
        "deliver_original_artwork",
        lambda path, **_kwargs: SimpleNamespace(status_code=200, path=path, headers={}),
    )

    response = browse_artist.api_artist_hero_by_id(
        SimpleNamespace(), 5, composition="desktop", size=1480
    )

    assert response.status_code == 503
    assert response.headers["X-Crate-Artwork"] == "hero-pending"
    assert queued == [
        (
            "recompose_artist_hero",
            {"artist": "Artist"},
            "recompose-artist-hero:5",
        )
    ]
