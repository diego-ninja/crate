"""Vector and endpoint helpers for Music Paths."""

from __future__ import annotations

import logging

from crate.db.queries.paths import (
    fetch_bliss_vectors_for_endpoint,
    resolve_endpoint_label as _resolve_endpoint_label,
)

log = logging.getLogger(__name__)


def _centroid(vectors: list[list[float]]) -> list[float]:
    """Average of N bliss vectors (element-wise mean)."""
    if not vectors:
        return []
    n = len(vectors)
    dims = len(vectors[0])
    return [sum(v[d] for v in vectors) / n for d in range(dims)]


def _lerp(a: list[float], b: list[float], t: float) -> list[float]:
    """Linear interpolation between two vectors. t=0 -> a, t=1 -> b."""
    return [a[d] + (b[d] - a[d]) * t for d in range(len(a))]


def resolve_bliss_centroid(endpoint_type: str, value: str) -> list[float] | None:
    """Resolve an endpoint (track/album/artist/genre) to a bliss centroid vector."""
    log.info("resolve_bliss_centroid: type=%s value=%s", endpoint_type, value)
    vectors = fetch_bliss_vectors_for_endpoint(endpoint_type, value)
    if endpoint_type == "artist":
        log.info("resolve artist id=%s: found %d vectors", value, len(vectors))
    return _centroid(vectors) if vectors else None


def resolve_endpoint_label(endpoint_type: str, value: str) -> str:
    return _resolve_endpoint_label(endpoint_type, value)


__all__ = [
    "_centroid",
    "_lerp",
    "resolve_bliss_centroid",
    "resolve_endpoint_label",
]
