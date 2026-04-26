from __future__ import annotations

from crate.db.repositories.user_library_playback_writes import (
    record_play,
    record_play_event,
)
from crate.db.repositories.user_library_preferences import (
    follow_artist,
    like_track,
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
    "save_album",
    "unfollow_artist",
    "unlike_track",
    "unsave_album",
]
