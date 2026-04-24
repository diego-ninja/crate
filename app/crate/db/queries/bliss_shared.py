from __future__ import annotations

from crate.db.tx import optional_scope as bliss_session_scope


def normalize_similarity_score(score: float | int | str | None) -> float:
    try:
        value = float(score or 0.0)
    except (TypeError, ValueError):
        return 0.0
    if value <= 0.0:
        return 0.0
    if value <= 1.0:
        return value
    if value <= 100.0:
        return value / 100.0
    return 1.0


__all__ = ["bliss_session_scope", "normalize_similarity_score"]
