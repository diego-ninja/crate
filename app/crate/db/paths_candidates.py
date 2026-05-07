"""Candidate selection helpers for Music Paths."""

from __future__ import annotations

import re

from crate.db.queries.paths import find_anchor_track_row, find_candidate_rows

_MAX_CONSECUTIVE_SAME_ARTIST = 2
_ARTIST_REPEAT_PENALTY = 2.0
_CANDIDATE_POOL_SIZE = 15

_W_BLISS = 0.34
_W_ARTIST_AFFINITY = 0.22
_W_GENRE_OVERLAP = 0.16
_W_BPM = 0.09
_W_KEY = 0.05
_W_ENERGY = 0.08
_W_ERA = 0.03

_LOW_SIGNAL_TITLE_RE = re.compile(
    r"\b(intro|interlude|outro|reprise|skit|spoken word|voice memo|voicemail|announcement|commentary)\b",
    re.IGNORECASE,
)
_ALT_VERSION_RE = re.compile(
    r"\b(live|remaster(?:ed)?|redux|re-recorded|acoustic|orchestral|alternate take|alt take|session|demo|version|mix|edit|radio edit|instrumental|karaoke|acapella|a cappella)\b",
    re.IGNORECASE,
)


def _find_anchor_track(
    endpoint_type: str,
    endpoint_value: str,
    target_vec: list[float],
    exclude: set[int],
) -> dict | None:
    """Find the best track that belongs to the endpoint (artist/album/genre)."""
    return find_anchor_track_row(endpoint_type, endpoint_value, target_vec, exclude)


def _coerce_float(value) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result


def _coerce_year(value) -> int | None:
    try:
        year = int(value)
    except (TypeError, ValueError):
        return None
    if year <= 0:
        return None
    return year


def _latest_track_context(recent_tracks: list[dict] | None) -> dict | None:
    if not recent_tracks:
        return None
    for row in reversed(recent_tracks):
        if row:
            return row
    return None


def _bpm_penalty(candidate: dict, context: dict | None) -> float:
    if not context:
        return 0.0
    cand_bpm = _coerce_float(candidate.get("bpm"))
    ctx_bpm = _coerce_float(context.get("bpm"))
    if cand_bpm is None or ctx_bpm is None:
        return 0.0
    return min(abs(cand_bpm - ctx_bpm) / 40.0, 1.0)


def _key_penalty(candidate: dict, context: dict | None) -> float:
    if not context:
        return 0.0
    cand_key = (candidate.get("audio_key") or "").strip().upper()
    ctx_key = (context.get("audio_key") or "").strip().upper()
    cand_scale = (candidate.get("audio_scale") or "").strip().lower()
    ctx_scale = (context.get("audio_scale") or "").strip().lower()
    if not cand_key or not ctx_key:
        return 0.0
    if cand_key == ctx_key and cand_scale == ctx_scale:
        return 0.0
    if cand_key == ctx_key:
        return 0.15
    if cand_scale and ctx_scale and cand_scale == ctx_scale:
        return 0.35
    return 0.65


def _energy_penalty(candidate: dict, context: dict | None) -> float:
    if not context:
        return 0.0
    cand_energy = _coerce_float(candidate.get("energy"))
    ctx_energy = _coerce_float(context.get("energy"))
    if cand_energy is None or ctx_energy is None:
        return 0.0
    return min(abs(cand_energy - ctx_energy), 1.0)


def _era_penalty(candidate: dict, context: dict | None) -> float:
    if not context:
        return 0.0
    cand_year = _coerce_year(candidate.get("year"))
    ctx_year = _coerce_year(context.get("year"))
    if cand_year is None or ctx_year is None:
        return 0.0
    return min(abs(cand_year - ctx_year) / 25.0, 1.0)


def _curation_penalty(candidate: dict) -> float:
    title = (candidate.get("title") or "").strip()
    album = (candidate.get("album") or "").strip()
    text = f"{title} {album}".strip()
    penalty = 0.0
    if title and _LOW_SIGNAL_TITLE_RE.search(title):
        penalty += 0.12
    if text and _ALT_VERSION_RE.search(text):
        penalty += 0.08
    duration = _coerce_float(candidate.get("duration"))
    if duration is not None and 0 < duration < 75:
        penalty += 0.03
    return min(penalty, 0.25)


def _find_best_candidate(
    target: list[float],
    exclude_ids: set[int],
    exclude_titles: set[str],
    recent_artists: list[str],
    sim_graph: dict[str, dict[str, float]],
    genre_map: dict[str, dict[str, float]],
    member_graph: dict[str, set[str]],
    target_artists: list[str],
    *,
    artist_affinity=lambda *_args, **_kwargs: 0.0,
    genre_overlap=lambda *_args, **_kwargs: 0.0,
    candidate_pool_size: int = _CANDIDATE_POOL_SIZE,
    recent_tracks: list[dict] | None = None,
) -> dict | None:
    """Find the best track near ``target`` using hybrid bliss/affinity scoring."""
    rows = find_candidate_rows(target, exclude_ids, limit=candidate_pool_size)
    if not rows:
        return None

    max_dist = max(float(row["distance"]) for row in rows) or 1.0
    best: dict | None = None
    best_score = float("inf")
    track_context = _latest_track_context(recent_tracks)

    for row in rows:
        candidate = dict(row)
        artist = candidate["artist"]
        title = candidate["title"]
        title_key = f"{artist}::{title}".lower()

        if title_key in exclude_titles:
            continue

        if recent_artists:
            consecutive = sum(1 for recent_artist in reversed(recent_artists) if recent_artist == artist)
            if consecutive >= _MAX_CONSECUTIVE_SAME_ARTIST:
                continue

        bliss_norm = float(candidate["distance"]) / max_dist
        affinity = artist_affinity(artist, recent_artists + target_artists, sim_graph, member_graph)
        overlap = genre_overlap(artist, target_artists, genre_map)

        score = (
            _W_BLISS * bliss_norm
            + _W_ARTIST_AFFINITY * (1.0 - affinity)
            + _W_GENRE_OVERLAP * (1.0 - overlap)
            + _W_BPM * _bpm_penalty(candidate, track_context)
            + _W_KEY * _key_penalty(candidate, track_context)
            + _W_ENERGY * _energy_penalty(candidate, track_context)
            + _W_ERA * _era_penalty(candidate, track_context)
            + _curation_penalty(candidate)
        )

        if artist in [recent_artist for recent_artist in recent_artists[-2:]]:
            score *= _ARTIST_REPEAT_PENALTY

        if score < best_score:
            best_score = score
            best = candidate

    if best:
        best["bliss_vector"] = list(best["bliss_vector"]) if best.get("bliss_vector") else None

    return best


__all__ = [
    "_find_anchor_track",
    "_find_best_candidate",
]
