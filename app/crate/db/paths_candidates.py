"""Candidate selection helpers for Music Paths."""

from __future__ import annotations

from crate.db.queries.paths import find_anchor_track_row, find_candidate_rows

_MAX_CONSECUTIVE_SAME_ARTIST = 2
_ARTIST_REPEAT_PENALTY = 2.0
_CANDIDATE_POOL_SIZE = 15

_W_BLISS = 0.40
_W_ARTIST_AFFINITY = 0.35
_W_GENRE_OVERLAP = 0.25


def _find_anchor_track(
    endpoint_type: str,
    endpoint_value: str,
    target_vec: list[float],
    exclude: set[int],
) -> dict | None:
    """Find the best track that belongs to the endpoint (artist/album/genre)."""
    return find_anchor_track_row(endpoint_type, endpoint_value, target_vec, exclude)


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
) -> dict | None:
    """Find the best track near ``target`` using hybrid bliss/affinity scoring."""
    rows = find_candidate_rows(target, exclude_ids, limit=_CANDIDATE_POOL_SIZE)
    if not rows:
        return None

    max_dist = max(float(row["distance"]) for row in rows) or 1.0
    best: dict | None = None
    best_score = float("inf")

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
