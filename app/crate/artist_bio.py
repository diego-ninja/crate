"""Normalization helpers for provider-sourced artist biographies."""

from __future__ import annotations

import html
import re


_LASTFM_ATTRIBUTION = re.compile(
    r"user\s*[-–—]\s*contributed\s+text\s+is\s+available\s+"
    r"under\s+the\s+creative\s+commons\s+by\s*[-–—]\s*sa\s+license\s*;\s*"
    r"additional\s+terms\s+may\s+apply\.?",
    re.IGNORECASE,
)
_LASTFM_READ_MORE = re.compile(r"\s*read\s+more\s+on\s+last\.fm\s*\.?", re.IGNORECASE)
_HTML_BLOCK_END = re.compile(
    r"(?is)</(?:p|div|li|ul|ol|h[1-6]|section|article|blockquote|tr|td|th)>"
)
_HTML_BREAK = re.compile(r"(?is)<br\s*/?>")
_HTML_TAG = re.compile(r"(?is)<[^>]+>")
_HTML_UNSAFE_BLOCK = re.compile(r"(?is)<(?:script|style)\b[^>]*>.*?</(?:script|style)>")


def _strip_markup(value: str) -> str:
    value = _HTML_UNSAFE_BLOCK.sub("\n", value)
    value = _HTML_BREAK.sub("\n", value)
    value = _HTML_BLOCK_END.sub("\n\n", value)
    return _HTML_TAG.sub("", value)


def _normalize_whitespace(value: str) -> str:
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in value.splitlines()]
    normalized = "\n".join(lines)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    normalized = re.sub(r"[ \t]+([,.;:!?])", r"\1", normalized)
    return normalized.strip()


def normalize_artist_bio(value: str | None) -> str:
    """Return safe, plain-text artist bio content.

    Provider boilerplate is removed conservatively and the operation is
    idempotent so it can be used for both ingestion and backfills.
    """
    if not value:
        return ""

    cleaned = html.unescape(str(value).replace("\r\n", "\n").replace("\r", "\n"))
    cleaned = _strip_markup(cleaned)
    cleaned = _LASTFM_READ_MORE.sub("", cleaned)
    cleaned = _LASTFM_ATTRIBUTION.sub("", cleaned)
    return _normalize_whitespace(cleaned)


__all__ = ["normalize_artist_bio"]
