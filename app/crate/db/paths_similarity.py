"""Similarity and graph loaders for Music Paths."""

from __future__ import annotations

import logging

from crate.db.queries.paths import (
    load_artist_genres,
    load_artist_similarity_graph,
    load_shared_members_graph,
)
from crate.genre_taxonomy import get_genre_ancestor_slugs, get_related_genre_terms, resolve_genre_slug, slugify_genre

log = logging.getLogger(__name__)


def _load_artist_similarity_graph() -> dict[str, dict[str, float]]:
    return load_artist_similarity_graph()


def _load_shared_members_graph() -> dict[str, set[str]]:
    graph = load_shared_members_graph()
    log.info("Shared members graph: %d artists connected", len(graph))
    return graph


def _load_artist_genres() -> dict[str, dict[str, float]]:
    return load_artist_genres()


def _expand_genre_weights(genres: dict[str, float]) -> dict[str, float]:
    expanded: dict[str, float] = {}
    for raw_genre, raw_weight in (genres or {}).items():
        weight = float(raw_weight or 0.0)
        if weight <= 0:
            continue
        canonical_slug = resolve_genre_slug(raw_genre) or slugify_genre(raw_genre)
        if not canonical_slug:
            continue
        ancestors = get_genre_ancestor_slugs(canonical_slug, include_self=True) or [canonical_slug]
        for index, slug in enumerate(ancestors):
            weighted = weight if index == 0 else weight * 0.65
            expanded[slug] = max(expanded.get(slug, 0.0), weighted)
        for related_term in get_related_genre_terms(canonical_slug, limit=12, max_depth=1):
            related_slug = resolve_genre_slug(related_term) or slugify_genre(related_term)
            if related_slug and related_slug not in expanded:
                expanded[related_slug] = weight * 0.35
    return expanded


def _artist_affinity(
    candidate_artist: str,
    context_artists: list[str],
    sim_graph: dict[str, dict[str, float]],
    member_graph: dict[str, set[str]],
) -> float:
    """Return how connected ``candidate_artist`` is to the recent context artists."""
    candidate_lower = candidate_artist.lower()
    if not context_artists:
        return 0.0

    best = 0.0
    for context_artist in context_artists:
        context_lower = context_artist.lower()

        if candidate_lower in member_graph.get(context_lower, set()):
            return 0.95

        direct = sim_graph.get(context_lower, {}).get(candidate_lower, 0.0)
        if direct > best:
            best = direct

        if best < 0.5:
            context_sims = sim_graph.get(context_lower, {})
            candidate_sims = sim_graph.get(candidate_lower, {})
            shared = set(context_sims.keys()) & set(candidate_sims.keys())
            if shared:
                second_degree = max(min(context_sims[item], candidate_sims[item]) for item in shared) * 0.5
                if second_degree > best:
                    best = second_degree

    return min(best, 1.0)


def _genre_overlap(
    candidate_artist: str,
    target_artists: list[str],
    genre_map: dict[str, dict[str, float]],
) -> float:
    """Weighted Jaccard-like genre overlap between candidate and target artists."""
    candidate_genres = _expand_genre_weights(genre_map.get(candidate_artist.lower(), {}))
    if not candidate_genres or not target_artists:
        return 0.0

    best = 0.0
    for target_artist in target_artists:
        target_genres = _expand_genre_weights(genre_map.get(target_artist.lower(), {}))
        if not target_genres:
            continue
        shared_keys = set(candidate_genres.keys()) & set(target_genres.keys())
        if not shared_keys:
            continue
        intersection = sum(min(candidate_genres[key], target_genres[key]) for key in shared_keys)
        union = sum(
            max(candidate_genres.get(key, 0), target_genres.get(key, 0))
            for key in set(candidate_genres.keys()) | set(target_genres.keys())
        )
        jaccard = intersection / union if union > 0 else 0.0
        if jaccard > best:
            best = jaccard
    return best


__all__ = [
    "_artist_affinity",
    "_genre_overlap",
    "_load_artist_genres",
    "_load_artist_similarity_graph",
    "_load_shared_members_graph",
]
