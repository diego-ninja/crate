"""Smart playlist generators using the local library database."""

import logging

from crate.db.playlists import (
    generate_by_artist,
    generate_by_decade,
    generate_by_genre,
    generate_random,
    generate_similar_artists as _generate_similar_artists,
)
from crate.lastfm import get_artist_info

log = logging.getLogger(__name__)


def generate_similar_artists(artist_name: str, limit: int = 50) -> list[int]:
    info = get_artist_info(artist_name)
    if not info or not info.get("similar"):
        return []
    similar_names = [s.get("name", "") for s in info["similar"] if s.get("name")]
    if not similar_names:
        return []
    return _generate_similar_artists(similar_names, limit=limit)
