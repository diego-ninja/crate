from __future__ import annotations

from crate.db.queries.genres_library_catalog import (
    get_all_genres,
    get_total_genre_count,
    get_unmapped_genre_count,
    get_unmapped_genres,
    list_unmapped_genres_for_inference,
)
from crate.db.queries.genres_library_detail import (
    get_albums_with_genres,
    get_artist_album_genres,
    get_artists_missing_genre_mapping,
    get_artists_with_tags,
    get_genre_detail,
)


__all__ = [
    "get_all_genres",
    "get_albums_with_genres",
    "get_artist_album_genres",
    "get_artists_missing_genre_mapping",
    "get_artists_with_tags",
    "get_genre_detail",
    "get_total_genre_count",
    "get_unmapped_genre_count",
    "get_unmapped_genres",
    "list_unmapped_genres_for_inference",
]
