from __future__ import annotations

import re
import unicodedata

_APOSTROPHE_RE = re.compile(r"['\u2018\u2019\u02bc\u0060\u00b4]")
_PUNCT_RE = re.compile(r"[^\w\s]")
_WS_RE = re.compile(r"\s+")

_LIVEISH_MARKER_RE = re.compile(
    r"\b("
    r"live|remix|mixed by|dj mix|dub|instrumental|karaoke|commentary"
    r")\b",
    re.IGNORECASE,
)
_ALT_MARKER_RE = re.compile(
    r"\b("
    r"acoustic|demo|session|radio edit|edit|version|alternate take|alt take|"
    r"take \d+|take|re[- ]?recorded|redux|orchestral|bbc|peel"
    r")\b",
    re.IGNORECASE,
)
_STUDIOISH_MARKER_RE = re.compile(
    r"\b("
    r"remaster(?:ed)?|mono|stereo|anniversary edition|deluxe edition"
    r")\b",
    re.IGNORECASE,
)
_TRAILING_BRACKET_RE = re.compile(r"\s*[\(\[]\s*([^\)\]]+?)\s*[\)\]]\s*$")


def _normalize_text(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "").strip().casefold()
    text = _APOSTROPHE_RE.sub("", text)
    text = _PUNCT_RE.sub(" ", text)
    text = _WS_RE.sub(" ", text).strip()
    return text


def _normalized_track_title_key(title: str) -> str:
    return _normalize_text(title or "")


def _variant_marker_rank(marker: str) -> int:
    if not marker:
        return 0
    if _LIVEISH_MARKER_RE.search(marker):
        return 3
    if _ALT_MARKER_RE.search(marker):
        return 2
    if _STUDIOISH_MARKER_RE.search(marker):
        return 1
    return 0


def _split_trailing_separator_suffix(title: str) -> tuple[str, str] | None:
    for separator in (" - ", " – ", ": "):
        if separator not in title:
            continue
        head, tail = title.rsplit(separator, 1)
        if _variant_marker_rank(tail) > 0:
            return head.rstrip(), tail.strip()
    return None


def _iter_variant_markers(title: str) -> list[str]:
    working = unicodedata.normalize("NFKC", title or "").strip()
    markers: list[str] = []
    while working:
        bracket_match = _TRAILING_BRACKET_RE.search(working)
        if bracket_match and _variant_marker_rank(bracket_match.group(1)) > 0:
            markers.append(bracket_match.group(1))
            working = working[: bracket_match.start()].rstrip(" -–:")
            continue

        split = _split_trailing_separator_suffix(working)
        if split is not None:
            working, marker = split
            markers.append(marker)
            continue

        break
    return markers


def track_variant_rank(title: str) -> int:
    markers = _iter_variant_markers(title)
    if not markers:
        return 0
    return max(_variant_marker_rank(marker) for marker in markers)


def canonical_track_title_key(title: str) -> str:
    working = unicodedata.normalize("NFKC", title or "").strip()
    while working:
        bracket_match = _TRAILING_BRACKET_RE.search(working)
        if bracket_match and _variant_marker_rank(bracket_match.group(1)) > 0:
            working = working[: bracket_match.start()].rstrip(" -–:")
            continue

        split = _split_trailing_separator_suffix(working)
        if split is not None:
            working, _marker = split
            continue

        break

    normalized = _normalize_text(working)
    if normalized:
        return normalized
    return _normalize_text(title)


def track_song_identity(row: dict) -> tuple[str, str] | None:
    title_key = canonical_track_title_key(str(row.get("title") or ""))
    if not title_key:
        return None
    artist_key = _normalize_text(str(row.get("artist") or row.get("artist_name") or ""))
    return artist_key, title_key


def prefers_track_variant(candidate: dict, current: dict) -> bool:
    candidate_rank = track_variant_rank(str(candidate.get("title") or ""))
    current_rank = track_variant_rank(str(current.get("title") or ""))
    if candidate_rank != current_rank:
        return candidate_rank < current_rank
    return False


def dedupe_track_variants(rows: list[dict]) -> list[dict]:
    grouped: dict[tuple[str, str], list[tuple[int, dict]]] = {}
    passthrough: list[tuple[int, dict]] = []

    for index, row in enumerate(rows):
        identity = track_song_identity(row)
        if identity is None:
            passthrough.append((index, row))
            continue
        grouped.setdefault(identity, []).append((index, row))

    ordered = [
        (index, row)
        for index, row in passthrough
    ]
    for entries in grouped.values():
        if len(entries) == 1:
            ordered.append(entries[0])
            continue

        raw_title_keys = {_normalized_track_title_key(str(row.get("title") or "")) for _index, row in entries}
        ranks = [track_variant_rank(str(row.get("title") or "")) for _index, row in entries]
        has_version_signal = any(rank > 0 for rank in ranks) or len(raw_title_keys) > 1
        if not has_version_signal:
            ordered.extend(entries)
            continue

        best_index, best_row = entries[0]
        for index, row in entries[1:]:
            if prefers_track_variant(row, best_row):
                best_row = row
        ordered.append((best_index, best_row))

    ordered.sort(key=lambda item: item[0])
    return [row for _index, row in ordered]


__all__ = [
    "canonical_track_title_key",
    "dedupe_track_variants",
    "prefers_track_variant",
    "track_song_identity",
    "track_variant_rank",
]
