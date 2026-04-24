from __future__ import annotations

from crate.db.repositories.user_library_aggregates import recompute_user_listening_aggregates
from crate.db.repositories.user_library_mutations import (
    follow_artist,
    like_track,
    record_play,
    record_play_event,
    save_album,
    unfollow_artist,
    unlike_track,
    unsave_album,
)

__all__ = [
    "follow_artist",
    "like_track",
    "record_play",
    "record_play_event",
    "recompute_user_listening_aggregates",
    "save_album",
    "unfollow_artist",
    "unlike_track",
    "unsave_album",
]
