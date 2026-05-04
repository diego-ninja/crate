from __future__ import annotations

import subprocess
from pathlib import Path

from crate.streaming.paths import resolve_data_file
from crate.db.repositories.streaming import get_variant_by_cache_key, mark_variant_failed, mark_variant_ready


class StreamVariantError(RuntimeError):
    pass


def transcode_variant(cache_key: str, *, timeout_seconds: int = 900) -> dict:
    row = get_variant_by_cache_key(cache_key)
    if not row:
        raise StreamVariantError(f"Unknown stream variant: {cache_key}")

    source_path = Path(str(row.get("source_path") or ""))
    if not source_path.is_file():
        error = "Source audio file is missing"
        mark_variant_failed(cache_key, error)
        raise StreamVariantError(error)

    output_path = resolve_data_file(row.get("relative_path"))
    if output_path is None:
        error = "Invalid variant output path"
        mark_variant_failed(cache_key, error)
        raise StreamVariantError(error)

    if output_path.is_file() and output_path.stat().st_size > 0:
        ready = mark_variant_ready(cache_key, row["relative_path"], output_path.stat().st_size)
        return ready or row

    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_suffix(f"{output_path.suffix}.tmp")
    if tmp_path.exists():
        tmp_path.unlink()

    bitrate = int(row.get("delivery_bitrate") or 192)
    sample_rate = int(row.get("delivery_sample_rate") or 44_100)
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i",
        str(source_path),
        "-vn",
        "-map_metadata",
        "0",
        "-c:a",
        "aac",
        "-b:a",
        f"{bitrate}k",
        "-ac",
        "2",
        "-ar",
        str(sample_rate),
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        str(tmp_path),
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_seconds)
        if result.returncode != 0:
            error = (result.stderr or result.stdout or "ffmpeg failed").strip()[-2000:]
            mark_variant_failed(cache_key, error)
            raise StreamVariantError(error)
        if not tmp_path.is_file() or tmp_path.stat().st_size <= 0:
            error = "ffmpeg produced an empty variant"
            mark_variant_failed(cache_key, error)
            raise StreamVariantError(error)
        tmp_path.replace(output_path)
        ready = mark_variant_ready(cache_key, row["relative_path"], output_path.stat().st_size)
        return ready or row
    except Exception as exc:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass
        if isinstance(exc, StreamVariantError):
            raise
        mark_variant_failed(cache_key, str(exc))
        raise
