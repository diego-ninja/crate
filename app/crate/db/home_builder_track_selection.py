from __future__ import annotations

from crate.track_versions import dedupe_track_variants


def _select_diverse_tracks(
    rows: list[dict],
    *,
    limit: int,
    max_per_artist: int = 2,
    max_per_album: int = 2,
) -> list[dict]:
    rows = dedupe_track_variants(rows)
    selected: list[dict] = []
    seen_tracks: set[object] = set()
    artist_counts: dict[str, int] = {}
    album_counts: dict[tuple[str, str], int] = {}

    for row in rows:
        track_key = row.get("track_id") or row.get("track_path")
        if not track_key or track_key in seen_tracks:
            continue
        artist_name = (row.get("artist") or "").strip().lower()
        album_key = (artist_name, (row.get("album") or "").strip().lower())
        if artist_name and artist_counts.get(artist_name, 0) >= max_per_artist:
            continue
        if album_key[1] and album_counts.get(album_key, 0) >= max_per_album:
            continue

        seen_tracks.add(track_key)
        if artist_name:
            artist_counts[artist_name] = artist_counts.get(artist_name, 0) + 1
        if album_key[1]:
            album_counts[album_key] = album_counts.get(album_key, 0) + 1
        selected.append(row)
        if len(selected) >= limit:
            break

    return selected


def _merge_track_rows(*collections: list[dict]) -> list[dict]:
    merged: list[dict] = []
    seen_tracks: set[object] = set()

    for rows in collections:
        for row in rows:
            track_key = row.get("track_id") or row.get("track_path")
            if not track_key or track_key in seen_tracks:
                continue
            seen_tracks.add(track_key)
            merged.append(row)

    return merged


def _select_diverse_tracks_with_backfill(
    rows: list[dict],
    *,
    limit: int,
    max_per_artist: int = 2,
    max_per_album: int = 2,
) -> list[dict]:
    if limit <= 0:
        return []

    rows = dedupe_track_variants(rows)
    selected: list[dict] = []
    seen_tracks: set[object] = set()
    artist_counts: dict[str, int] = {}
    album_counts: dict[tuple[str, str], int] = {}
    passes = [
        (max_per_artist, max_per_album),
        (max(max_per_artist + 1, 3), max(max_per_album + 1, 3)),
        (limit, limit),
    ]

    for artist_limit, album_limit in passes:
        for row in rows:
            track_key = row.get("track_id") or row.get("track_path")
            if not track_key or track_key in seen_tracks:
                continue
            artist_name = (row.get("artist") or "").strip().lower()
            album_key = (artist_name, (row.get("album") or "").strip().lower())
            if artist_name and artist_counts.get(artist_name, 0) >= artist_limit:
                continue
            if album_key[1] and album_counts.get(album_key, 0) >= album_limit:
                continue

            seen_tracks.add(track_key)
            if artist_name:
                artist_counts[artist_name] = artist_counts.get(artist_name, 0) + 1
            if album_key[1]:
                album_counts[album_key] = album_counts.get(album_key, 0) + 1
            selected.append(row)
            if len(selected) >= limit:
                return selected

    return selected


__all__ = [
    "_merge_track_rows",
    "_select_diverse_tracks",
    "_select_diverse_tracks_with_backfill",
]
