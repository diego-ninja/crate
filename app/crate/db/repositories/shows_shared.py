from __future__ import annotations

import re


def normalize_venue(name: str | None) -> str:
    if not name:
        return ""
    normalized = name.lower().strip()
    normalized = re.sub(r"^(the|la|el|le|les|los|das|die|den)\s+", "", normalized)
    normalized = re.sub(r"\s*(sala|hall|venue|theatre|theater|arena|club|room)\s*", " ", normalized)
    normalized = re.sub(r"[^a-z0-9\s]", "", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def normalize_artist(name: str | None) -> str:
    if not name:
        return ""
    return re.sub(r"\s+", " ", name.lower().strip())


__all__ = ["normalize_artist", "normalize_venue"]
