"""Index genres from existing data: artist enrichment tags, album/track genre tags."""

import json
import logging

from crate.db import set_artist_genres, set_album_genres, get_or_create_genre
from crate.db.genres import (
    get_albums_with_genres,
    get_artist_album_genres,
    get_artists_missing_genre_mapping,
    get_artists_with_tags,
    get_total_genre_count,
)

log = logging.getLogger(__name__)


def index_all_genres(progress_callback=None) -> dict:
    """Build genre index from all available data sources."""
    artist_count = 0
    album_count = 0
    genre_count = 0

    # 1. Artist genres from enrichment tags (Last.fm + Spotify)
    artists = get_artists_with_tags()

    for i, row in enumerate(artists):
        name = row["name"]
        tags = row["tags_json"]
        if isinstance(tags, str):
            tags = json.loads(tags) if tags else []
        if not tags:
            continue

        # Weight by position: first tag = 1.0, decaying
        genres = []
        for j, tag in enumerate(tags):
            tag = tag.strip()
            if not tag or len(tag) < 2:
                continue
            weight = max(0.1, 1.0 - j * 0.12)
            genres.append((tag, weight, "enrichment"))

        if genres:
            set_artist_genres(name, genres)
            artist_count += 1

        if progress_callback and i % 20 == 0:
            progress_callback({"phase": "artists", "done": i, "total": len(artists)})

    # 2. Album genres from track tags
    albums = get_albums_with_genres()

    for i, row in enumerate(albums):
        album_genres_raw: set[str] = set()

        # From album genre field
        if row["genre"]:
            for g in row["genre"].split(","):
                g = g.strip()
                if g:
                    album_genres_raw.add(g)

        # From track genres
        track_genres = row.get("track_genres") or []
        for tg in track_genres:
            if tg:
                for g in tg.split(","):
                    g = g.strip()
                    if g:
                        album_genres_raw.add(g)

        if album_genres_raw:
            genres = [(g, 1.0, "tags") for g in album_genres_raw]
            set_album_genres(row["id"], genres)
            album_count += 1

        if progress_callback and i % 50 == 0:
            progress_callback({"phase": "albums", "done": i, "total": len(albums)})

    # 3. Derive artist genres from their album genres (for artists without enrichment tags)
    if progress_callback:
        progress_callback({"phase": "deriving_artist_genres"})

    missing_artists = get_artists_missing_genre_mapping()

    for i, artist_name in enumerate(missing_artists):
        # Aggregate genres from all albums, weighted by frequency
        rows = get_artist_album_genres(artist_name)

        if not rows:
            continue

        max_cnt = rows[0]["cnt"]
        genres = []
        for r in rows:
            weight = r["cnt"] / max_cnt  # Normalize: most frequent = 1.0
            genres.append((r["name"], round(weight, 2), "derived"))

        set_artist_genres(artist_name, genres)
        artist_count += 1

        if progress_callback and i % 50 == 0:
            progress_callback({"phase": "deriving_artist_genres", "done": i, "total": len(missing_artists)})

    # Count total genres
    genre_count = get_total_genre_count()

    return {
        "artists_indexed": artist_count,
        "albums_indexed": album_count,
        "total_genres": genre_count,
    }
