from __future__ import annotations

import base64
import io
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image

from tests.conftest import PG_AVAILABLE


def _image_bytes(size: tuple[int, int] = (1600, 1000)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color=(24, 118, 145)).save(buffer, "PNG")
    return buffer.getvalue()


def _crop_recipe(width: int, height: int) -> dict:
    return {
        "mode": "crop",
        "crop": {"x": 0, "y": 0, "width": width, "height": height},
        "position_x": 0.5,
        "position_y": 0.5,
        "scale": 1.0,
        "flip_horizontal": False,
        "rotation": 0,
        "blur": 32,
        "feather": 28,
        "gradient": 0.45,
        "grayscale": False,
        "brightness": 1.0,
        "contrast": 1.0,
    }


def test_artist_hero_revision_changes_with_renderer_version():
    from crate import artist_hero_artwork

    with patch.object(artist_hero_artwork, "ARTIST_HERO_RENDER_VERSION", "v1"):
        first = artist_hero_artwork.artist_hero_revision(b"same-source")
    with patch.object(artist_hero_artwork, "ARTIST_HERO_RENDER_VERSION", "v2"):
        second = artist_hero_artwork.artist_hero_revision(b"same-source")

    assert first != second


def test_artist_hero_revision_identifies_the_current_renderer():
    from crate.artist_hero_artwork import (
        ARTIST_HERO_RENDER_VERSION,
        artist_hero_revision,
    )

    assert artist_hero_revision(b"source").startswith(f"{ARTIST_HERO_RENDER_VERSION}:")


def test_artist_hero_render_tolerates_untyped_recipe_values():
    from crate.artist_hero_artwork import render_artist_hero_composition

    source = Image.open(io.BytesIO(_image_bytes()))
    result = render_artist_hero_composition(
        source,
        {
            **_crop_recipe(1400, 600),
            "rotation": object(),
            "brightness": object(),
            "contrast": None,
            "position_x": object(),
            "position_y": object(),
            "scale": object(),
        },
        (100, 50),
    )

    assert result.size == (100, 50)


def test_artist_hero_preview_renders_without_mutating_the_profile(
    monkeypatch, tmp_path
):
    from crate.worker_handlers.artwork import _handle_preview_artist_hero

    monkeypatch.setenv("DATA_DIR", str(tmp_path / "cache"))
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_library_artist",
        lambda _artist: {"id": 7, "name": "Converge"},
    )
    raw = _image_bytes((1600, 1000))
    result = _handle_preview_artist_hero(
        "preview-task",
        {
            "artist": "Converge",
            "composition": "desktop",
            "data_b64": base64.b64encode(raw).decode(),
            "recipe": _crop_recipe(1400, 600),
        },
        {"library_path": str(tmp_path / "library")},
    )

    assert result["status"] == "previewed"
    assert result["view"]["composition"] == "desktop"
    preview_path = tmp_path / "cache" / "artist-hero-previews"
    assert list(preview_path.glob("*.webp"))


def test_crop_composition_renders_exact_desktop_and_mobile_sizes():
    from crate.artist_hero_artwork import (
        DESKTOP_HERO_RENDER_SIZE,
        MOBILE_HERO_RENDER_SIZE,
        render_artist_hero_compositions,
    )

    source = Image.open(io.BytesIO(_image_bytes()))

    rendered = render_artist_hero_compositions(
        source,
        desktop_recipe=_crop_recipe(1400, 600),
        mobile_recipe=_crop_recipe(800, 1000),
    )

    assert rendered["desktop"].size == DESKTOP_HERO_RENDER_SIZE
    assert rendered["mobile"].size == MOBILE_HERO_RENDER_SIZE


def test_crop_composition_rotates_source_clockwise():
    from PIL import ImageDraw

    from crate.api.schemas.artwork import ArtistHeroRecipe
    from crate.artist_hero_artwork import render_artist_hero_composition

    source = Image.new("RGB", (200, 100))
    draw = ImageDraw.Draw(source)
    draw.rectangle((0, 0, 99, 99), fill=(240, 20, 20))
    draw.rectangle((100, 0, 199, 99), fill=(20, 20, 240))
    recipe = {
        **_crop_recipe(100, 200),
        "rotation": 90,
    }

    validated = ArtistHeroRecipe.model_validate(recipe)
    result = render_artist_hero_composition(source, recipe, (100, 200))

    assert validated.rotation == 90
    assert result.getpixel((50, 30))[0] > result.getpixel((50, 30))[2]
    assert result.getpixel((50, 170))[2] > result.getpixel((50, 170))[0]


def test_extend_composition_uses_cover_fit_like_the_editor_fill_mode():
    from crate.artist_hero_artwork import (
        render_artist_hero_composition,
    )

    source = Image.new("RGB", (700, 1000), color=(230, 50, 70))
    recipe = {
        **_crop_recipe(700, 1000),
        "mode": "extend",
        "position_x": 0.5,
        "position_y": 0.5,
        "scale": 1.0,
    }

    result = render_artist_hero_composition(source, recipe, (1680, 720))

    assert result.getpixel((0, 360)) == (230, 50, 70)
    assert result.getpixel((840, 360)) == (230, 50, 70)
    assert result.getpixel((1679, 360)) == (230, 50, 70)


def test_shared_geometry_fixtures_match_the_backend_bounds():
    from crate.artist_hero_artwork import get_artist_hero_artwork_bounds

    fixtures_path = (
        Path(__file__).parents[1]
        / "shared"
        / "ui"
        / "domain"
        / "artist-hero-fixtures.json"
    )
    fixtures = json.loads(fixtures_path.read_text())
    for fixture in fixtures:
        expected = fixture["expected_frame"]
        target = fixture["target"]
        bounds = get_artist_hero_artwork_bounds(
            (
                fixture["source"]["width"],
                fixture["source"]["height"],
            ),
            fixture["recipe"],
            (target["width"], target["height"]),
        )
        assert bounds == pytest.approx(
            {
                "left": expected["x"] / target["width"],
                "top": expected["y"] / target["height"],
                "right": (expected["x"] + expected["width"]) / target["width"],
                "bottom": (expected["y"] + expected["height"]) / target["height"],
            }
        )


def test_extend_artwork_bounds_follow_the_real_subject_rectangle():
    from crate.artist_hero_artwork import get_artist_hero_artwork_bounds

    recipe = {
        **_crop_recipe(700, 1000),
        "mode": "extend",
        "position_x": 0.5,
        "position_y": 0.5,
        "scale": 1.0,
    }

    bounds = get_artist_hero_artwork_bounds((700, 1000), recipe, (1680, 720))

    assert bounds == pytest.approx(
        {"left": 0.0, "top": -1.167, "right": 1.0, "bottom": 2.167},
        abs=0.001,
    )


def test_crop_artwork_bounds_cover_the_whole_composition():
    from crate.artist_hero_artwork import get_artist_hero_artwork_bounds

    bounds = get_artist_hero_artwork_bounds(
        (1600, 1000), _crop_recipe(1400, 600), (1480, 600)
    )

    assert bounds == {"left": 0.0, "top": 0.0, "right": 1.0, "bottom": 1.0}


def test_extend_composition_accepts_subject_placement_beyond_the_canvas():
    from crate.api.schemas.artwork import ArtistHeroRecipe

    recipe = ArtistHeroRecipe.model_validate(
        {
            **_crop_recipe(700, 1000),
            "mode": "extend",
            "position_x": 1.4,
            "position_y": -0.25,
        }
    )

    assert recipe.position_x == 1.4
    assert recipe.position_y == -0.25


def test_extend_composition_does_not_bake_presentation_gradients():
    from crate.artist_hero_artwork import render_artist_hero_composition

    source = Image.new("RGB", (1000, 500), color=(220, 120, 70))
    recipe = {
        **_crop_recipe(1000, 500),
        "mode": "extend",
        "scale": 2,
        "feather": 0,
        "gradient": 0,
    }

    result = render_artist_hero_composition(source, recipe, (1000, 500))
    center = result.getpixel((500, 250))

    assert result.getpixel((0, 250)) == center
    assert result.getpixel((999, 250)) == center
    assert result.getpixel((500, 0)) == center
    assert result.getpixel((500, 499)) == center


def test_composition_applies_artist_image_treatment():
    from crate.artist_hero_artwork import render_artist_hero_composition

    source = Image.new("RGB", (1000, 500), color=(160, 80, 40))
    recipe = {
        **_crop_recipe(1000, 500),
        "mode": "extend",
        "grayscale": True,
        "brightness": 0.5,
        "contrast": 1.25,
    }

    result = render_artist_hero_composition(source, recipe, (1000, 500))
    red, green, blue = result.getpixel((500, 250))

    assert red == green == blue
    assert red < 80


def test_artist_hero_recipe_defaults_to_an_untreated_image():
    from crate.api.schemas.artwork import ArtistHeroRecipe

    validated = ArtistHeroRecipe.model_validate(_crop_recipe(1000, 500))

    assert validated.grayscale is False
    assert validated.brightness == 1.0
    assert validated.contrast == 1.0


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_artist_hero_profile_round_trip(pg_db):
    from crate.db.repositories.artist_hero_artwork import (
        get_artist_hero_artwork,
        list_artist_hero_backfill_candidates,
        update_artist_hero_review_status,
        upsert_artist_hero_artwork,
    )
    from crate.db.tx import read_scope
    from sqlalchemy import text

    pg_db.upsert_artist({"name": "Artwork Profile Artist"})
    with read_scope() as session:
        artist_id = session.execute(
            text("SELECT id FROM library_artists WHERE name = 'Artwork Profile Artist'")
        ).scalar_one()

    assert artist_id in {
        row["id"]
        for row in list_artist_hero_backfill_candidates(
            after_id=max(0, artist_id - 1), limit=10
        )
    }

    upsert_artist_hero_artwork(
        artist_id=artist_id,
        provenance="manual",
        review_status="approved",
        source_width=1600,
        source_height=1000,
        desktop_recipe=_crop_recipe(1400, 600),
        mobile_recipe=_crop_recipe(800, 1000),
        revision="revision-1",
        render_manifest={
            "manifest_version": 1,
            "editorial_revision": "revision-1",
            "artifacts": {
                "desktop": {
                    "renderer_version": "cover-fit-v4",
                    "render_revision": "artifact-desktop-1",
                    "source_fingerprint": "sha256:desktop",
                    "recipe_hash": "desktop-hash",
                    "relative_path": "artist-hero/7/desktop/artifact.webp",
                }
            },
        },
    )

    profile = get_artist_hero_artwork(artist_id)

    assert profile is not None
    assert profile["provenance"] == "manual"
    assert profile["review_status"] == "approved"
    assert profile["desktop_recipe"]["mode"] == "crop"
    assert profile["revision"] == "revision-1"
    assert profile["render_manifest"]["manifest_version"] == 1
    assert artist_id not in {
        row["id"]
        for row in list_artist_hero_backfill_candidates(
            after_id=max(0, artist_id - 1), limit=10
        )
    }

    assert update_artist_hero_review_status(artist_id, "rejected") is True
    reviewed_profile = get_artist_hero_artwork(artist_id)
    assert reviewed_profile is not None
    assert reviewed_profile["review_status"] == "rejected"
    assert reviewed_profile["revision"] != "revision-1"


def test_artist_hero_upload_endpoint_enqueues_original_and_both_recipes(test_app):
    desktop = _crop_recipe(1400, 600)
    mobile = _crop_recipe(800, 1000)

    with (
        patch("crate.api.artwork.artist_name_from_id", return_value="Converge"),
        patch("crate.api.artwork.create_task", return_value="task-hero-1") as create,
    ):
        response = test_app.post(
            "/api/artwork/artists/7/upload-hero",
            files={"file": ("converge.png", _image_bytes(), "image/png")},
            data={
                "desktop_recipe": json.dumps(desktop),
                "mobile_recipe": json.dumps(mobile),
            },
        )

    assert response.status_code == 200
    assert response.json() == {"status": "queued", "task_id": "task-hero-1"}
    task_type, payload = create.call_args.args
    assert task_type == "upload_image"
    assert payload["type"] == "artist_hero"
    assert payload["artist"] == "Converge"
    assert payload["desktop_recipe"] == desktop
    assert payload["mobile_recipe"] == mobile
    assert base64.b64decode(payload["data_b64"]).startswith(b"\x89PNG")


def test_artist_hero_upload_can_replace_only_the_mobile_source(test_app):
    desktop = _crop_recipe(1400, 600)
    mobile = _crop_recipe(800, 1000)

    with (
        patch("crate.api.artwork.artist_name_from_id", return_value="Converge"),
        patch("crate.api.artwork.create_task", return_value="task-mobile-1") as create,
    ):
        response = test_app.post(
            "/api/artwork/artists/7/upload-hero",
            files={"file": ("converge-mobile.png", _image_bytes(), "image/png")},
            data={
                "desktop_recipe": json.dumps(desktop),
                "mobile_recipe": json.dumps(mobile),
                "composition": "mobile",
            },
        )

    assert response.status_code == 200
    payload = create.call_args.args[1]
    assert payload["composition"] == "mobile"


def test_artist_hero_upload_rejects_invalid_image_before_queueing(test_app):
    desktop = _crop_recipe(1400, 600)
    mobile = _crop_recipe(800, 1000)

    with (
        patch("crate.api.artwork.artist_name_from_id", return_value="Converge"),
        patch("crate.api.artwork.create_task") as create,
    ):
        response = test_app.post(
            "/api/artwork/artists/7/upload-hero",
            files={"file": ("broken.jpg", b"not-an-image", "image/jpeg")},
            data={
                "desktop_recipe": json.dumps(desktop),
                "mobile_recipe": json.dumps(mobile),
            },
        )

    assert response.status_code == 400
    assert response.json() == {"error": "Invalid image"}
    create.assert_not_called()


def test_artist_hero_compose_endpoint_reuses_persisted_source(test_app):
    desktop = _crop_recipe(1400, 600)
    mobile = _crop_recipe(800, 1000)

    with (
        patch("crate.api.artwork.artist_name_from_id", return_value="Converge"),
        patch("crate.api.artwork.create_task", return_value="task-compose-1") as create,
    ):
        response = test_app.post(
            "/api/artwork/artists/7/compose-hero",
            json={"desktop_recipe": desktop, "mobile_recipe": mobile},
        )

    assert response.status_code == 200
    assert response.json() == {"status": "queued", "task_id": "task-compose-1"}
    create.assert_called_once_with(
        "compose_artist_hero",
        {
            "artist": "Converge",
            "desktop_recipe": desktop,
            "mobile_recipe": mobile,
            "composition": "shared",
        },
    )


def test_artist_hero_compose_endpoint_passes_active_desktop_composition(test_app):
    desktop = _crop_recipe(1400, 600)
    mobile = _crop_recipe(800, 1000)

    with (
        patch("crate.api.artwork.artist_name_from_id", return_value="Crossed"),
        patch(
            "crate.api.artwork.create_task", return_value="task-compose-desktop"
        ) as create,
    ):
        response = test_app.post(
            "/api/artwork/artists/7/compose-hero",
            json={
                "desktop_recipe": desktop,
                "mobile_recipe": mobile,
                "composition": "desktop",
            },
        )

    assert response.status_code == 200
    assert create.call_args.args[1]["composition"] == "desktop"


def test_artist_hero_profile_endpoint_returns_persisted_metadata(test_app):
    profile = {
        "artist_id": 7,
        "provenance": "manual",
        "review_status": "approved",
        "source_width": 1600,
        "source_height": 1000,
        "desktop_recipe": _crop_recipe(1400, 600),
        "mobile_recipe": _crop_recipe(800, 1000),
        "revision": "revision-1",
        "updated_at": "2026-08-01T09:00:00+00:00",
    }

    with (
        patch("crate.api.artwork.artist_name_from_id", return_value="Converge"),
        patch(
            "crate.api.artwork.get_artist_hero_artwork",
            return_value=profile,
        ),
        patch(
            "crate.api.artwork.get_artist_featured_state",
            return_value={"is_featured": False},
        ),
    ):
        response = test_app.get("/api/artwork/artists/7/hero-profile")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["provenance"] == "manual"
    assert response.json()["desktop_recipe"]["mode"] == "crop"


def test_artist_hero_source_endpoint_delivers_the_editable_original(test_app, tmp_path):
    artist_dir = tmp_path / "Converge"
    artist_dir.mkdir()
    source = artist_dir / "artist-hero-source.jpg"
    Image.new("RGB", (1600, 1000), color=(24, 118, 145)).save(source, "JPEG")

    with (
        patch("crate.api.artwork.artist_name_from_id", return_value="Converge"),
        patch(
            "crate.api.artwork.get_library_artist",
            return_value={"id": 7, "name": "Converge", "folder_name": "Converge"},
        ),
        patch("crate.api.artwork.library_path", return_value=tmp_path),
        patch(
            "crate.api.artwork.get_artist_hero_artwork",
            return_value={"mobile_enabled": True},
        ),
    ):
        response = test_app.get("/api/artwork/artists/7/hero-source")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"].startswith("private")
    assert response.content.startswith(b"\xff\xd8")


def test_artist_hero_source_endpoint_delivers_a_composition_override(
    test_app, tmp_path
):
    artist_dir = tmp_path / "Converge"
    artist_dir.mkdir()
    Image.new("RGB", (1080, 1350), color=(80, 40, 120)).save(
        artist_dir / "artist-hero-source-mobile.jpg", "JPEG"
    )

    with (
        patch("crate.api.artwork.artist_name_from_id", return_value="Converge"),
        patch(
            "crate.api.artwork.get_library_artist",
            return_value={"id": 7, "name": "Converge", "folder_name": "Converge"},
        ),
        patch("crate.api.artwork.library_path", return_value=tmp_path),
        patch(
            "crate.api.artwork.get_artist_hero_artwork",
            return_value={"mobile_enabled": True},
        ),
    ):
        response = test_app.get("/api/artwork/artists/7/hero-source?composition=mobile")

    assert response.status_code == 200
    assert Image.open(io.BytesIO(response.content)).size == (1080, 1350)


def test_delete_artist_hero_composition_enqueues_persistent_delete(test_app):
    profile = {
        "desktop_enabled": True,
        "mobile_enabled": True,
    }
    with (
        patch("crate.api.artwork.artist_name_from_id", return_value="Converge"),
        patch("crate.api.artwork.get_artist_hero_artwork", return_value=profile),
        patch(
            "crate.api.artwork.create_task", return_value="task-delete-hero"
        ) as create,
    ):
        response = test_app.delete("/api/artwork/artists/7/hero-profile/desktop")

    assert response.status_code == 200
    assert response.json() == {"status": "queued", "task_id": "task-delete-hero"}
    create.assert_called_once_with(
        "delete_artist_hero_composition",
        {"artist": "Converge", "artist_id": 7, "composition": "desktop"},
    )


def test_derive_artist_hero_endpoint_queues_background_conversion(test_app):
    with (
        patch("crate.api.artwork.artist_name_from_id", return_value="Converge"),
        patch("crate.api.artwork.create_task", return_value="task-derive-1") as create,
    ):
        response = test_app.post("/api/artwork/artists/7/derive-hero")

    assert response.status_code == 200
    assert response.json() == {"status": "queued", "task_id": "task-derive-1"}
    create.assert_called_once_with("derive_artist_hero", {"artist": "Converge"})


def test_review_artist_hero_endpoint_updates_status(test_app):
    events: list[str] = []
    with (
        patch("crate.api.artwork.artist_name_from_id", return_value="Converge"),
        patch(
            "crate.api.artwork.update_artist_hero_review_status", return_value=True
        ) as update,
        patch(
            "crate.api.cache_events.broadcast_invalidation",
            side_effect=lambda *_scopes: events.append("broadcast"),
        ),
        patch(
            "crate.api.cache_events.wait_for_cache_invalidation",
            side_effect=lambda: events.append("wait"),
        ),
        patch(
            "crate.db.home_warming.warm_recent_home_discovery_snapshots",
            side_effect=lambda: events.append("warm"),
        ),
    ):
        response = test_app.patch(
            "/api/artwork/artists/7/hero-profile",
            json={"review_status": "approved"},
        )

    assert response.status_code == 200
    assert response.json() == {"status": "approved"}
    update.assert_called_once_with(7, "approved")
    assert events == ["broadcast", "wait", "warm"]


def test_artist_hero_backfill_endpoint_queues_bounded_scan(test_app):
    with patch(
        "crate.api.artwork.create_task", return_value="task-backfill-1"
    ) as create:
        response = test_app.post("/api/artwork/artist-heroes/backfill")

    assert response.status_code == 200
    assert response.json() == {"status": "queued", "task_id": "task-backfill-1"}
    create.assert_called_once_with(
        "backfill_artist_heroes", {"after_artist_id": 0, "batch_size": 25}
    )


def test_upload_handler_writes_hero_variants_and_profile(monkeypatch, tmp_path):
    from crate.worker_handlers.artwork import _handle_upload_image

    artist_dir = tmp_path / "Converge"
    artist_dir.mkdir()
    desktop_recipe = {
        **_crop_recipe(1400, 600),
        "mode": "extend",
        "scale": 1.37,
        "position_x": 0.21,
        "position_y": 0.77,
    }
    mobile_recipe = _crop_recipe(800, 1000)
    queued: list[tuple[str, str]] = []
    profiles: list[dict] = []
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_library_artist",
        lambda name: {"id": 7, "entity_uid": "artist-entity", "name": name},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.resolve_artist_dir",
        lambda *args, **kwargs: artist_dir,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_artist_hero_artwork",
        lambda _artist_id: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.upsert_artist_hero_artwork",
        lambda **kwargs: profiles.append(kwargs),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.queue_artwork_materialization",
        lambda asset, *, reason: queued.append((asset.kind, asset.entity_key)),
    )
    with (
        patch("crate.api.cache_events.broadcast_invalidation"),
        patch("crate.db.home_warming.warm_recent_home_discovery_snapshots") as warm,
    ):
        result = _handle_upload_image(
            "task-1",
            {
                "type": "artist_hero",
                "artist": "Converge",
                "data_b64": base64.b64encode(_image_bytes()).decode(),
                "desktop_recipe": desktop_recipe,
                "mobile_recipe": mobile_recipe,
            },
            {"library_path": str(tmp_path)},
        )

    assert result["type"] == "artist_hero"
    assert (artist_dir / "artist-hero-source.jpg").is_file()
    assert Image.open(artist_dir / "artist-hero-desktop.webp").size == (2960, 1200)
    assert Image.open(artist_dir / "artist-hero-mobile.webp").size == (2160, 2700)
    assert profiles[0]["provenance"] == "manual"
    assert profiles[0]["desktop_recipe"] == desktop_recipe
    assert queued == [
        ("artist-hero", "artist-entity:desktop"),
        ("artist-hero", "artist-entity:mobile"),
    ]
    warm.assert_called_once_with()


def test_upload_handler_normalizes_exif_orientation_before_persisting_hero_source(
    monkeypatch, tmp_path
):
    from crate.worker_handlers.artwork import _handle_upload_image

    artist_dir = tmp_path / "Birds in Row"
    artist_dir.mkdir()
    source = Image.new("RGB", (200, 100), color=(24, 118, 145))
    exif = Image.Exif()
    exif[274] = 6
    source_buffer = io.BytesIO()
    source.save(source_buffer, "JPEG", exif=exif)
    profiles: list[dict] = []

    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_library_artist",
        lambda name: {"id": 7, "entity_uid": "artist-entity", "name": name},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.resolve_artist_dir",
        lambda *args, **kwargs: artist_dir,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_artist_hero_artwork",
        lambda _artist_id: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.upsert_artist_hero_artwork",
        lambda **kwargs: profiles.append(kwargs),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.queue_artwork_materialization",
        lambda *args, **kwargs: None,
    )

    with (
        patch("crate.api.cache_events.broadcast_invalidation"),
        patch("crate.db.home_warming.warm_recent_home_discovery_snapshots"),
    ):
        _handle_upload_image(
            "task-1",
            {
                "type": "artist_hero",
                "artist": "Birds in Row",
                "data_b64": base64.b64encode(source_buffer.getvalue()).decode(),
                "desktop_recipe": _crop_recipe(100, 200),
                "mobile_recipe": _crop_recipe(100, 200),
            },
            {"library_path": str(tmp_path)},
        )

    with Image.open(artist_dir / "artist-hero-source.jpg") as persisted:
        assert persisted.size == (100, 200)
        assert persisted.getexif().get(274, 1) == 1
    assert profiles[0]["desktop_source_width"] == 100
    assert profiles[0]["desktop_source_height"] == 200


def test_upload_handler_replaces_only_mobile_source_and_variant(monkeypatch, tmp_path):
    from crate.worker_handlers.artwork import _handle_upload_image

    artist_dir = tmp_path / "Converge"
    artist_dir.mkdir()
    Image.new("RGB", (1800, 900), color=(180, 40, 20)).save(
        artist_dir / "artist-hero-source-desktop.jpg", "JPEG"
    )
    Image.new("RGB", (1480, 600), color=(180, 40, 20)).save(
        artist_dir / "artist-hero-desktop.webp", "WEBP"
    )
    original_desktop = (artist_dir / "artist-hero-desktop.webp").read_bytes()
    profiles: list[dict] = []
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_library_artist",
        lambda name: {"id": 7, "entity_uid": "artist-entity", "name": name},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.resolve_artist_dir",
        lambda *args, **kwargs: artist_dir,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_artist_hero_artwork",
        lambda _artist_id: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_artist_hero_artwork",
        lambda _artist_id: {
            "source_width": 1800,
            "source_height": 900,
            "desktop_source_width": 1800,
            "desktop_source_height": 900,
            "desktop_recipe": _crop_recipe(1400, 600),
            "mobile_recipe": _crop_recipe(800, 1000),
            "provenance": "manual",
            "review_status": "approved",
        },
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.upsert_artist_hero_artwork",
        lambda **kwargs: profiles.append(kwargs),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.queue_artwork_materialization",
        lambda *args, **kwargs: None,
    )

    with patch("crate.api.cache_events.broadcast_invalidation"):
        result = _handle_upload_image(
            "task-1",
            {
                "type": "artist_hero",
                "artist": "Converge",
                "composition": "mobile",
                "data_b64": base64.b64encode(_image_bytes((1000, 1500))).decode(),
                "desktop_recipe": _crop_recipe(1400, 600),
                "mobile_recipe": _crop_recipe(800, 1000),
            },
            {"library_path": str(tmp_path)},
        )

    assert result["type"] == "artist_hero"
    assert (artist_dir / "artist-hero-desktop.webp").read_bytes() == original_desktop
    assert (artist_dir / "artist-hero-source-mobile.jpg").is_file()
    assert Image.open(artist_dir / "artist-hero-mobile.webp").size == (2160, 2700)
    assert profiles[0]["desktop_source_width"] == 1800
    assert profiles[0]["mobile_source_width"] == 1000


def test_compose_handler_rerenders_the_persisted_hero_source(monkeypatch, tmp_path):
    from crate.worker_handlers.artwork import _handle_compose_artist_hero

    artist_dir = tmp_path / "Converge"
    artist_dir.mkdir()
    Image.open(io.BytesIO(_image_bytes())).convert("RGB").save(
        artist_dir / "artist-hero-source.jpg", "JPEG", quality=94
    )
    queued: list[tuple[str, str]] = []
    profiles: list[dict] = []
    events: list[str] = []
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_library_artist",
        lambda name: {"id": 7, "entity_uid": "artist-entity", "name": name},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.resolve_artist_dir",
        lambda *args, **kwargs: artist_dir,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_artist_hero_artwork",
        lambda _artist_id: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.upsert_artist_hero_artwork",
        lambda **kwargs: profiles.append(kwargs),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.queue_artwork_materialization",
        lambda asset, *, reason: queued.append((asset.kind, asset.entity_key)),
    )

    with (
        patch(
            "crate.api.cache_events.broadcast_invalidation",
            side_effect=lambda *_scopes: events.append("broadcast"),
        ) as invalidate,
        patch(
            "crate.api.cache_events.wait_for_cache_invalidation",
            side_effect=lambda: events.append("wait"),
        ),
        patch(
            "crate.db.home_warming.warm_recent_home_discovery_snapshots",
            side_effect=lambda: events.append("warm"),
        ),
    ):
        result = _handle_compose_artist_hero(
            "task-1",
            {
                "artist": "Converge",
                "desktop_recipe": _crop_recipe(1400, 600),
                "mobile_recipe": _crop_recipe(800, 1000),
            },
            {"library_path": str(tmp_path)},
        )

    assert result["status"] == "composed"
    assert Image.open(artist_dir / "artist-hero-desktop.webp").size == (2960, 1200)
    assert Image.open(artist_dir / "artist-hero-mobile.webp").size == (2160, 2700)
    assert profiles[0]["provenance"] == "manual"
    assert profiles[0]["review_status"] == "approved"
    assert queued == [
        ("artist-hero", "artist-entity:desktop"),
        ("artist-hero", "artist-entity:mobile"),
    ]
    invalidate.assert_called_once_with("artist:7", "library", "home")
    assert events == ["broadcast", "wait", "warm"]


def test_compose_handler_can_update_only_desktop_when_mobile_source_is_missing(
    monkeypatch, tmp_path
):
    from crate.worker_handlers.artwork import _handle_compose_artist_hero

    artist_dir = tmp_path / "Crossed"
    artist_dir.mkdir()
    Image.open(io.BytesIO(_image_bytes((1800, 900)))).convert("RGB").save(
        artist_dir / "artist-hero-source-desktop.jpg", "JPEG", quality=94
    )
    Image.new("RGB", (1080, 1350), color=(220, 40, 70)).save(
        artist_dir / "artist-hero-mobile.webp", "WEBP"
    )
    mobile_before = (artist_dir / "artist-hero-mobile.webp").read_bytes()
    desktop_recipe = {
        **_crop_recipe(1400, 600),
        "mode": "extend",
        "scale": 1.37,
        "position_x": 0.21,
        "position_y": 0.77,
    }
    mobile_recipe = _crop_recipe(800, 1000)
    profiles: list[dict] = []
    queued: list[tuple[str, str]] = []

    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_library_artist",
        lambda name: {"id": 7, "entity_uid": "artist-entity", "name": name},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.resolve_artist_dir",
        lambda *args, **kwargs: artist_dir,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_artist_hero_artwork",
        lambda _artist_id: {
            "source_width": 1800,
            "source_height": 900,
            "desktop_recipe": _crop_recipe(1400, 600),
            "mobile_recipe": mobile_recipe,
            "mobile_source_width": 1600,
            "mobile_source_height": 1000,
            "mobile_source_origin": "manual-upload",
            "desktop_source_origin": "manual-upload",
        },
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.upsert_artist_hero_artwork",
        lambda **kwargs: profiles.append(kwargs),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.queue_artwork_materialization",
        lambda asset, *, reason: queued.append((asset.kind, asset.entity_key)),
    )

    with (
        patch("crate.api.cache_events.broadcast_invalidation"),
        patch("crate.db.home_warming.warm_recent_home_discovery_snapshots"),
    ):
        result = _handle_compose_artist_hero(
            "task-1",
            {
                "artist": "Crossed",
                "composition": "desktop",
                "desktop_recipe": desktop_recipe,
                "mobile_recipe": mobile_recipe,
            },
            {"library_path": str(tmp_path)},
        )

    assert result["status"] == "composed"
    assert Image.open(artist_dir / "artist-hero-desktop.webp").size == (2960, 1200)
    assert (artist_dir / "artist-hero-mobile.webp").read_bytes() == mobile_before
    assert profiles[0]["desktop_recipe"] == desktop_recipe
    assert queued == [("artist-hero", "artist-entity:desktop")]


def test_recompose_handler_refreshes_legacy_output_without_changing_profile(
    monkeypatch, tmp_path
):
    from crate.worker_handlers.artwork import _handle_recompose_artist_hero

    artist_dir = tmp_path / "Converge"
    artist_dir.mkdir()
    Image.new("RGB", (700, 1000), color=(230, 50, 70)).save(
        artist_dir / "artist-hero-source.jpg", "JPEG"
    )
    Image.new("RGB", (1480, 600), color=(0, 0, 0)).save(
        artist_dir / "artist-hero-desktop.webp", "WEBP"
    )
    profile = {
        "artist_id": 7,
        "provenance": "manual",
        "review_status": "approved",
        "source_width": 700,
        "source_height": 1000,
        "desktop_recipe": {
            **_crop_recipe(700, 1000),
            "mode": "extend",
            "position_x": 0.5,
            "position_y": 0.5,
        },
        "mobile_recipe": _crop_recipe(700, 1000),
        "revision": "legacy-renderer-revision",
        "desktop_source_width": 700,
        "desktop_source_height": 1000,
        "desktop_source_origin": "manual-upload",
        "mobile_source_width": 700,
        "mobile_source_height": 1000,
        "mobile_source_origin": "manual-upload",
    }
    profiles = []
    queued = []
    events = []
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_library_artist",
        lambda name: {"id": 7, "entity_uid": "artist-entity", "name": name},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.resolve_artist_dir",
        lambda *args, **kwargs: artist_dir,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_artist_hero_artwork",
        lambda _artist_id: profile,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.upsert_artist_hero_artwork",
        lambda **kwargs: profiles.append(kwargs),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.queue_artwork_materialization",
        lambda asset, *, reason: queued.append((asset.kind, asset.entity_key, reason)),
    )

    with (
        patch(
            "crate.api.cache_events.broadcast_invalidation",
            side_effect=lambda *_scopes: events.append("broadcast"),
        ),
        patch(
            "crate.api.cache_events.wait_for_cache_invalidation",
            side_effect=lambda: events.append("wait"),
        ),
        patch(
            "crate.db.home_warming.warm_recent_home_discovery_snapshots",
            side_effect=lambda: events.append("warm"),
        ),
    ):
        result = _handle_recompose_artist_hero(
            "task-1", {"artist": "Converge"}, {"library_path": str(tmp_path)}
        )

    assert result["status"] == "recomposed"
    with Image.open(artist_dir / "artist-hero-desktop.webp") as rendered:
        assert rendered.size == (2960, 1200)
        for pixel in (rendered.getpixel((0, 300)), rendered.getpixel((1479, 300))):
            assert pixel[0] > 200
            assert pixel[1] < 80
            assert pixel[2] < 100
    assert profiles[0]["provenance"] == "manual"
    assert profiles[0]["review_status"] == "approved"
    from crate.artist_hero_artwork import ARTIST_HERO_RENDER_VERSION

    assert profiles[0]["revision"].startswith(f"{ARTIST_HERO_RENDER_VERSION}:")
    assert queued == [
        ("artist-hero", "artist-entity:desktop", "renderer-migration"),
        ("artist-hero", "artist-entity:mobile", "renderer-migration"),
    ]
    assert events == ["broadcast", "wait", "warm"]


def test_derive_handler_creates_unreviewed_hero_from_large_background(
    monkeypatch, tmp_path
):
    from crate.worker_handlers.artwork import _handle_derive_artist_hero

    artist_dir = tmp_path / "Converge"
    artist_dir.mkdir()
    Image.new("RGB", (2200, 1100), color=(36, 75, 92)).save(
        artist_dir / "background.jpg"
    )
    profiles: list[dict] = []
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_library_artist",
        lambda name: {"id": 7, "entity_uid": "artist-entity", "name": name},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.resolve_artist_dir",
        lambda *args, **kwargs: artist_dir,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_artist_hero_artwork",
        lambda _artist_id: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.upsert_artist_hero_artwork",
        lambda **kwargs: profiles.append(kwargs),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.queue_artwork_materialization",
        lambda *args, **kwargs: None,
    )

    with (
        patch("crate.api.cache_events.broadcast_invalidation"),
        patch("crate.db.home_warming.warm_recent_home_discovery_snapshots") as warm,
    ):
        result = _handle_derive_artist_hero(
            "task-1", {"artist": "Converge"}, {"library_path": str(tmp_path)}
        )

    assert result["status"] == "derived"
    assert profiles[0]["provenance"] == "derived_background"
    assert profiles[0]["review_status"] == "unreviewed"
    assert (artist_dir / "artist-hero-mobile.webp").is_file()
    warm.assert_called_once_with()


def test_derive_handler_never_overwrites_manual_artwork(monkeypatch, tmp_path):
    from crate.worker_handlers.artwork import _handle_derive_artist_hero

    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_library_artist",
        lambda name: {"id": 7, "entity_uid": "artist-entity", "name": name},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_artist_hero_artwork",
        lambda _artist_id: {"provenance": "manual"},
    )

    result = _handle_derive_artist_hero(
        "task-1", {"artist": "Converge"}, {"library_path": str(tmp_path)}
    )

    assert result == {"status": "skipped", "reason": "manual-artwork"}


def test_backfill_handler_queues_candidates_and_bounded_continuation(monkeypatch):
    from crate.worker_handlers.artwork import _handle_backfill_artist_heroes

    queued: list[tuple[str, dict, str]] = []
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.list_artist_hero_backfill_candidates",
        lambda **kwargs: [
            {"id": 7, "name": "Converge", "entity_uid": "artist-7"},
            {"id": 8, "name": "Botch", "entity_uid": "artist-8"},
        ],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.create_task_dedup",
        lambda task_type, params, *, dedup_key: queued.append(
            (task_type, params, dedup_key)
        ),
    )

    result = _handle_backfill_artist_heroes(
        "task-1", {"after_artist_id": 0, "batch_size": 2}, {}
    )

    assert result["status"] == "continued"
    assert [task_type for task_type, _params, _key in queued] == [
        "derive_artist_hero",
        "derive_artist_hero",
        "backfill_artist_heroes",
    ]
    assert queued[-1][1]["after_artist_id"] == 8
