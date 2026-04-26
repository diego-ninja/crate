from __future__ import annotations

import re


def _trim_bio(value: str, max_length: int = 280) -> str:
    text_val = re.sub(r"\s+", " ", (value or "")).strip()
    if len(text_val) <= max_length:
        return text_val
    trimmed = text_val[:max_length].rsplit(" ", 1)[0].strip()
    return f"{trimmed}…"


__all__ = ["_trim_bio"]
