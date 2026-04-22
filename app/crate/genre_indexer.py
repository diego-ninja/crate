"""Index genres from existing data: artist enrichment tags, album/track genre tags."""

import json
import logging
import re
from collections import defaultdict

from crate.db import set_artist_genres, set_album_genres
from crate.db.genres import (
    get_albums_with_genres,
    get_artist_album_genres,
    get_artists_missing_genre_mapping,
    get_artists_with_tags,
    get_total_genre_count,
)
from crate.db.queries.browse_artist import get_artist_genre_profile

log = logging.getLogger(__name__)
_GENRE_SPLIT_RE = re.compile(r"[;,]")


def _split_genre_value(value: str | None) -> list[str]:
    if not value:
        return []
    seen: set[str] = set()
    genres: list[str] = []
    for part in _GENRE_SPLIT_RE.split(value):
        genre = part.strip().lower()
        if not genre or len(genre) < 2 or genre in seen:
            continue
        seen.add(genre)
        genres.append(genre)
    return genres


def _normalize_weighted_genres(
    scores: dict[str, float],
    *,
    source: str,
    max_items: int = 8,
    min_share: float = 0.08,
) -> list[tuple[str, float, str]]:
    if not scores:
        return []

    ordered = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    total = sum(score for _genre, score in ordered)
    if total <= 0:
        return []

    selected: list[tuple[str, float]] = []
    for index, (genre, score) in enumerate(ordered):
        share = score / total
        if index < 3 or share >= min_share:
            selected.append((genre, score))
        if len(selected) >= max_items:
            break

    if not selected:
        selected = ordered[: min(max_items, len(ordered))]

    selected_total = sum(score for _genre, score in selected)
    if selected_total <= 0:
        return []

    return [
        (genre, round(score / selected_total, 4), source)
        for genre, score in selected
    ]


def derive_album_genres(
    album_genre: str | None,
    track_genres: list[str] | None,
    artist_profile: list[dict] | None = None,
    *,
    max_items: int = 8,
) -> list[tuple[str, float, str]]:
    """Build a weighted genre profile for one album.

    Signals are taken from:
    1. album-level genre tag (strong prior)
    2. per-track genre tags (frequency across the album)
    3. artist genre profile as a weak fallback when the album has no direct tags
    """
    direct_scores: dict[str, float] = defaultdict(float)

    album_tags = _split_genre_value(album_genre)
    if album_tags:
        album_weight = 3.0 / len(album_tags)
        for genre in album_tags:
            direct_scores[genre] += album_weight

    for raw_track_genre in track_genres or []:
        track_tags = _split_genre_value(raw_track_genre)
        if not track_tags:
            continue
        track_weight = 1.0 / len(track_tags)
        for genre in track_tags:
            direct_scores[genre] += track_weight

    if direct_scores:
        return _normalize_weighted_genres(direct_scores, source="tags", max_items=max_items)

    fallback_scores: dict[str, float] = defaultdict(float)
    for item in artist_profile or []:
        name = str(item.get("name") or "").strip().lower()
        if not name:
            continue
        fallback_scores[name] += max(float(item.get("weight") or 0.0), 0.0)

    return _normalize_weighted_genres(
        fallback_scores,
        source="artist_fallback",
        max_items=max_items,
        min_share=0.1,
    )


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
    artist_profile_cache: dict[str, list[dict]] = {}

    for i, row in enumerate(albums):
        artist_name = row["artist"]
        artist_profile = artist_profile_cache.get(artist_name)
        if artist_profile is None:
            artist_profile = get_artist_genre_profile(artist_name, limit=8)
            artist_profile_cache[artist_name] = artist_profile
        genres = derive_album_genres(
            row.get("genre"),
            row.get("track_genres") or [],
            artist_profile=artist_profile,
        )

        if genres:
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

        max_score = float(rows[0]["score"] or 0.0)
        if max_score <= 0:
            continue
        genres = []
        for r in rows:
            weight = float(r["score"] or 0.0) / max_score  # Normalize: strongest signal = 1.0
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
