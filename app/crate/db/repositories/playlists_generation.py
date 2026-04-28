"""Compatibility facade for playlist generation helpers."""

from __future__ import annotations

from crate.db.repositories.playlists_generation_state import (
    log_generation_complete,
    log_generation_failed,
    log_generation_start,
    set_generation_status,
)
from crate.db.repositories.playlists_generators import (
    generate_by_artist,
    generate_by_decade,
    generate_by_genre,
    generate_random,
    generate_similar_artists,
)
from crate.db.repositories.playlists_rule_engine import execute_smart_rules


__all__ = [
    "execute_smart_rules",
    "generate_by_artist",
    "generate_by_decade",
    "generate_by_genre",
    "generate_random",
    "generate_similar_artists",
    "log_generation_complete",
    "log_generation_failed",
    "log_generation_start",
    "set_generation_status",
]
