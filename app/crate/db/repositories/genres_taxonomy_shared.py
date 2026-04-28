from __future__ import annotations

import re

from crate.genre_taxonomy import slugify_genre


def slugify_taxonomy_value(name: str) -> str:
    return slugify_genre(name)


def normalize_taxonomy_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower()).strip()


__all__ = [
    "normalize_taxonomy_text",
    "slugify_taxonomy_value",
]
