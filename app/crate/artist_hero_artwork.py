"""Render the two editorial artist-hero compositions from one source image."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping

from PIL import Image, ImageEnhance, ImageOps

from crate.utils import coerce_float, coerce_int

DESKTOP_HERO_SIZE = (1480, 600)
MOBILE_HERO_SIZE = (1080, 1350)
# Keep the public canvas dimensions above stable, but render the persisted
# composition at 2x so it remains sharp on high-density displays.
DESKTOP_HERO_RENDER_SIZE = (2960, 1200)
MOBILE_HERO_RENDER_SIZE = (2160, 2700)
MIN_IMAGE_TREATMENT = 0.5
MAX_IMAGE_TREATMENT = 1.5
MIN_FILL_POSITION = -1.0
MAX_FILL_POSITION = 2.0
ARTIST_HERO_RENDER_VERSION = "cover-fit-v5-neutral-alpha"


def artist_hero_revision(*parts: bytes) -> str:
    digest = hashlib.sha256(ARTIST_HERO_RENDER_VERSION.encode())
    for part in parts:
        digest.update(b"\0")
        digest.update(part)
    return f"{ARTIST_HERO_RENDER_VERSION}:{digest.hexdigest()[:16]}"


def _transform_source(source: Image.Image, recipe: Mapping[str, object]) -> Image.Image:
    transformed = source
    if recipe.get("flip_horizontal"):
        transformed = transformed.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

    rotation = coerce_int(recipe.get("rotation", 0)) % 360
    transpose = {
        90: Image.Transpose.ROTATE_270,
        180: Image.Transpose.ROTATE_180,
        270: Image.Transpose.ROTATE_90,
    }.get(rotation)
    return transformed.transpose(transpose) if transpose is not None else transformed


def _clamped_crop(image: Image.Image, raw_crop: object) -> Image.Image:
    if not isinstance(raw_crop, Mapping):
        return image.copy()
    x = max(0, min(coerce_int(raw_crop.get("x", 0)), image.width - 1))
    y = max(0, min(coerce_int(raw_crop.get("y", 0)), image.height - 1))
    width = max(
        1,
        min(
            coerce_int(raw_crop.get("width", image.width), image.width), image.width - x
        ),
    )
    height = max(
        1,
        min(
            coerce_int(raw_crop.get("height", image.height), image.height),
            image.height - y,
        ),
    )
    return image.crop((x, y, x + width, y + height))


def _apply_image_treatment(
    source: Image.Image, recipe: Mapping[str, object]
) -> Image.Image:
    treated = source
    if bool(recipe.get("grayscale", False)):
        treated = ImageOps.grayscale(treated).convert("RGB")

    brightness = max(
        MIN_IMAGE_TREATMENT,
        min(coerce_float(recipe.get("brightness", 1.0), 1.0), MAX_IMAGE_TREATMENT),
    )
    contrast = max(
        MIN_IMAGE_TREATMENT,
        min(coerce_float(recipe.get("contrast", 1.0), 1.0), MAX_IMAGE_TREATMENT),
    )
    if brightness != 1.0:
        treated = ImageEnhance.Brightness(treated).enhance(brightness)
    if contrast != 1.0:
        treated = ImageEnhance.Contrast(treated).enhance(contrast)
    return treated


def _offset_from_position(
    output_length: int, subject_length: int, position: float
) -> int:
    available = output_length - subject_length
    if 0.0 <= position <= 1.0:
        return round(available * position)
    direction = -1 if available < 0 else 1
    if position < 0.0:
        return round(position * output_length * direction)
    return round(available + (position - 1.0) * output_length * direction)


def _extended_subject_frame(
    source_size: tuple[int, int],
    recipe: Mapping[str, object],
    output_size: tuple[int, int],
) -> tuple[int, int, int, int]:
    source_width, source_height = source_size
    position_x = max(
        MIN_FILL_POSITION,
        min(coerce_float(recipe.get("position_x", 0.5), 0.5), MAX_FILL_POSITION),
    )
    position_y = max(
        MIN_FILL_POSITION,
        min(coerce_float(recipe.get("position_y", 0.5), 0.5), MAX_FILL_POSITION),
    )
    scale = max(0.25, min(coerce_float(recipe.get("scale", 1.0), 1.0), 2.0))
    fit_scale = max(
        output_size[0] / max(source_width, 1),
        output_size[1] / max(source_height, 1),
    )
    width = max(1, round(source_width * fit_scale * scale))
    height = max(1, round(source_height * fit_scale * scale))
    left = _offset_from_position(output_size[0], width, position_x)
    top = _offset_from_position(output_size[1], height, position_y)
    return left, top, width, height


def get_artist_hero_artwork_bounds(
    source_size: tuple[int, int],
    recipe: Mapping[str, object],
    output_size: tuple[int, int],
) -> dict[str, float]:
    if recipe.get("mode") != "extend":
        return {"left": 0.0, "top": 0.0, "right": 1.0, "bottom": 1.0}

    source_width, source_height = source_size
    if coerce_int(recipe.get("rotation", 0)) % 360 in {90, 270}:
        source_width, source_height = source_height, source_width
    left, top, width, height = _extended_subject_frame(
        (source_width, source_height), recipe, output_size
    )
    output_width, output_height = output_size
    return {
        "left": left / output_width,
        "top": top / output_height,
        "right": (left + width) / output_width,
        "bottom": (top + height) / output_height,
    }


def _render_extended(
    source: Image.Image, recipe: Mapping[str, object], output_size: tuple[int, int]
) -> Image.Image:
    left, top, width, height = _extended_subject_frame(source.size, recipe, output_size)
    subject_size = (width, height)
    subject = source.resize(subject_size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", output_size, (0, 0, 0, 0))
    canvas.paste(subject, (left, top))
    return canvas


def render_artist_hero_composition(
    source: Image.Image,
    recipe: Mapping[str, object],
    output_size: tuple[int, int],
) -> Image.Image:
    normalized = ImageOps.exif_transpose(source).convert("RGB")
    transformed = _transform_source(normalized, recipe)
    transformed = _apply_image_treatment(transformed, recipe)
    if recipe.get("mode") == "extend":
        return _render_extended(transformed, recipe, output_size)
    cropped = _clamped_crop(transformed, recipe.get("crop"))
    return ImageOps.fit(cropped, output_size, Image.Resampling.LANCZOS)


def render_artist_hero_compositions(
    source: Image.Image,
    *,
    desktop_recipe: Mapping[str, object],
    mobile_recipe: Mapping[str, object],
) -> dict[str, Image.Image]:
    return {
        "desktop": render_artist_hero_composition(
            source, desktop_recipe, DESKTOP_HERO_RENDER_SIZE
        ),
        "mobile": render_artist_hero_composition(
            source, mobile_recipe, MOBILE_HERO_RENDER_SIZE
        ),
    }
