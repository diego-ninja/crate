from io import BytesIO

from PIL import Image

from crate.api.image_variants import resize_image_bytes


def _make_image_bytes(size: tuple[int, int], *, image_format: str, color: str = "red") -> bytes:
    image = Image.new("RGB", size, color=color)
    output = BytesIO()
    image.save(output, format=image_format)
    return output.getvalue()


def test_resize_image_bytes_downsizes_large_jpeg():
    content = _make_image_bytes((1600, 1200), image_format="JPEG")

    resized, media_type = resize_image_bytes(content, "image/jpeg", size=256)

    assert media_type == "image/jpeg"
    assert len(resized) < len(content)
    image = Image.open(BytesIO(resized))
    assert max(image.size) == 256


def test_resize_image_bytes_downsizes_large_png():
    content = _make_image_bytes((1200, 1200), image_format="PNG")

    resized, media_type = resize_image_bytes(content, "image/png", size=128)

    assert media_type == "image/png"
    image = Image.open(BytesIO(resized))
    assert image.size == (128, 128)


def test_resize_image_bytes_can_emit_webp_variants():
    content = _make_image_bytes((1200, 1200), image_format="JPEG")

    resized, media_type = resize_image_bytes(content, "image/jpeg", size=256, output_format="webp")

    assert media_type == "image/webp"
    image = Image.open(BytesIO(resized))
    assert image.format == "WEBP"
    assert image.size == (256, 256)


def test_resize_image_bytes_leaves_unsupported_formats_untouched():
    content = b"<svg xmlns='http://www.w3.org/2000/svg'></svg>"

    resized, media_type = resize_image_bytes(content, "image/svg+xml", size=128, output_format="webp")

    assert media_type == "image/svg+xml"
    assert resized == content
