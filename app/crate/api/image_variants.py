"""Helpers for serving lightweight image variants to frontend clients."""

from __future__ import annotations

from io import BytesIO
from typing import Mapping

from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError

_RASTER_MEDIA_TO_FORMAT = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/webp": "WEBP",
}

_OUTPUT_FORMAT_TO_MEDIA = {
    "webp": "image/webp",
}

def resize_image_bytes(
    content: bytes,
    media_type: str,
    *,
    size: int | None = None,
    output_format: str | None = None,
) -> tuple[bytes, str]:
    target_media_type = _OUTPUT_FORMAT_TO_MEDIA.get((output_format or "").lower())
    if not size and not target_media_type:
        return content, media_type

    image_format = _RASTER_MEDIA_TO_FORMAT.get(media_type)
    if image_format is None:
        return content, media_type

    try:
        image = Image.open(BytesIO(content))
    except (UnidentifiedImageError, OSError):
        return content, media_type

    if size and max(image.size) > size:
        image.thumbnail((size, size), Image.Resampling.LANCZOS)
    elif not target_media_type:
        return content, media_type

    output = BytesIO()
    save_format = _RASTER_MEDIA_TO_FORMAT.get(target_media_type or media_type, image_format)

    if save_format == "JPEG":
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        image.save(output, format=save_format, quality=85, optimize=True, progressive=True)
    elif save_format == "PNG":
        image.save(output, format=save_format, optimize=True)
    else:
        image.save(output, format=save_format, quality=82, method=4)

    return output.getvalue(), target_media_type or media_type


def build_image_response(
    content: bytes,
    media_type: str,
    *,
    size: int | None = None,
    output_format: str | None = None,
    headers: Mapping[str, str] | None = None,
) -> Response:
    resized_content, resized_media_type = resize_image_bytes(
        content,
        media_type,
        size=size,
        output_format=output_format,
    )
    return Response(
        content=resized_content,
        media_type=resized_media_type,
        headers=dict(headers or {}),
    )
