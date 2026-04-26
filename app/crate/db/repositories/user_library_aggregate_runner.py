from __future__ import annotations

from crate.db.repositories.user_library_aggregate_shared import window_cutoff
from crate.db.repositories.user_library_daily_aggregates import recompute_user_daily_listening
from crate.db.repositories.user_library_entity_aggregates import (
    recompute_user_album_stats,
    recompute_user_artist_stats,
    recompute_user_genre_stats,
    recompute_user_track_stats,
)
from crate.db.repositories.user_library_shared import _STATS_WINDOWS
from crate.db.tx import transaction_scope


def recompute_user_listening_aggregates_in_session(session, user_id: int):
    recompute_user_daily_listening(session, user_id)
    for window, days in _STATS_WINDOWS.items():
        cutoff = window_cutoff(days)
        recompute_user_track_stats(session, user_id, window, cutoff)
        recompute_user_artist_stats(session, user_id, window, cutoff)
        recompute_user_album_stats(session, user_id, window, cutoff)
        recompute_user_genre_stats(session, user_id, window, cutoff)


def recompute_user_listening_aggregates(user_id: int) -> None:
    with transaction_scope() as session:
        recompute_user_listening_aggregates_in_session(session, user_id)


__all__ = [
    "recompute_user_listening_aggregates",
    "recompute_user_listening_aggregates_in_session",
]
