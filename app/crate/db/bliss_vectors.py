"""Helpers for bliss vectors stored as pgvector embeddings."""

from __future__ import annotations

BLISS_VECTOR_DIMS = 20


def to_pgvector_literal(vector: list[float]) -> str:
    """Format a bliss vector as pgvector input text."""
    return "[" + ",".join(f"{value:.8f}" for value in vector) + "]"
