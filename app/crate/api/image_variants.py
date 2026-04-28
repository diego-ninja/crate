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


def resize_image_bytes(content: bytes, media_type: str, *, size: int | None = None) -> tuple[bytes, str]:
    if not size:
        return content, media_type

    image_format = _RASTER_MEDIA_TO_FORMAT.get(media_type)
    if image_format is None:
        return content, media_type

    try:
        image = Image.open(BytesIO(content))
    except (UnidentifiedImageError, OSError):
        return content, media_type

    if max(image.size) <= size:
        return content, media_type

    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    output = BytesIO()

    if image_format == "JPEG":
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        image.save(output, format=image_format, quality=85, optimize=True, progressive=True)
    elif image_format == "PNG":
        image.save(output, format=image_format, optimize=True)
    else:
        image.save(output, format=image_format, quality=85, method=6)

    return output.getvalue(), media_type


def build_image_response(
    content: bytes,
    media_type: str,
    *,
    size: int | None = None,
    headers: Mapping[str, str] | None = None,
) -> Response:
    resized_content, resized_media_type = resize_image_bytes(content, media_type, size=size)
    return Response(
        content=resized_content,
        media_type=resized_media_type,
        headers=dict(headers or {}),
    )
