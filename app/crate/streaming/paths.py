from __future__ import annotations

import os
from pathlib import Path


def data_root() -> Path:
    return Path(os.environ.get("DATA_DIR", "/data")).resolve()


def stream_cache_root() -> Path:
    return data_root() / "stream-cache"


def variant_relative_path(cache_key: str, preset: str, extension: str) -> str:
    safe_preset = "".join(ch if ch.isalnum() or ch in ("_", "-") else "-" for ch in preset)
    return str(Path("stream-cache") / safe_preset / cache_key[:2] / cache_key[2:4] / f"{cache_key}.{extension}")


def resolve_data_file(relative_path: str | None) -> Path | None:
    if not relative_path:
        return None
    root = data_root()
    candidate = (root / relative_path).resolve()
    if not candidate.is_relative_to(root):
        return None
    return candidate
