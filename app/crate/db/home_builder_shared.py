from __future__ import annotations

import re
from datetime import date, datetime, timezone


def _coerce_datetime(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc)
    if not value:
        return None
    text_val = str(value).strip()
    if not text_val:
        return None
    try:
        if "T" in text_val:
            parsed = datetime.fromisoformat(text_val.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        parsed_date = date.fromisoformat(text_val)
        return datetime.combine(parsed_date, datetime.min.time(), tzinfo=timezone.utc)
    except ValueError:
        return None


def _coerce_date(value: object) -> date | None:
    parsed = _coerce_datetime(value)
    return parsed.date() if parsed else None


def _trim_bio(value: str, max_length: int = 280) -> str:
    text_val = re.sub(r"\s+", " ", (value or "")).strip()
    if len(text_val) <= max_length:
        return text_val
    trimmed = text_val[:max_length].rsplit(" ", 1)[0].strip()
    return f"{trimmed}…"


def _daily_rotation_index(pool_size: int, user_id: int) -> int:
    if pool_size <= 1:
        return 0
    return (date.today().toordinal() + max(user_id, 0)) % pool_size


def _artist_identity(row: dict) -> object | None:
    artist_slug = (row.get("artist_slug") or "").strip().lower()
    if artist_slug:
        return ("slug", artist_slug)
    artist_id = row.get("artist_id")
    if artist_id is not None:
        return ("id", artist_id)
    artist_name = (row.get("artist") or "").strip().lower()
    if artist_name:
        return ("name", artist_name)
    return None


def _album_identity(row: dict) -> object | None:
    artist_identity = _artist_identity(row)
    album_slug = (row.get("album_slug") or "").strip().lower()
    if album_slug:
        return ("slug", artist_identity, album_slug)
    album_name = (row.get("album") or "").strip().lower()
    if album_name:
        return ("name", artist_identity, album_name)
    album_id = row.get("album_id")
    if album_id is not None:
        return ("id", album_id)
    return None


def _track_payload(row: dict) -> dict:
    return {
        "track_id": row.get("track_id"),
        "track_storage_id": str(row["track_storage_id"]) if row.get("track_storage_id") is not None else None,
        "track_path": row.get("track_path"),
        "title": row.get("title") or "",
        "artist": row.get("artist") or "",
        "artist_id": row.get("artist_id"),
        "artist_slug": row.get("artist_slug"),
        "album": row.get("album") or "",
        "album_id": row.get("album_id"),
        "album_slug": row.get("album_slug"),
        "duration": row.get("duration"),
        "format": row.get("format"),
        "bitrate": (row["bitrate"] // 1000) if row.get("bitrate") else None,
        "sample_rate": row.get("sample_rate"),
        "bit_depth": row.get("bit_depth"),
    }


def _artwork_tracks(rows: list[dict], limit: int = 4) -> list[dict]:
    artwork: list[dict] = []
    seen: set[tuple[object, str, str]] = set()
    for row in rows:
        key = (row.get("album_id"), row.get("artist") or "", row.get("album") or "")
        if key in seen:
            continue
        seen.add(key)
        artwork.append(
            {
                "artist": row.get("artist"),
                "artist_id": row.get("artist_id"),
                "artist_slug": row.get("artist_slug"),
                "album": row.get("album"),
                "album_id": row.get("album_id"),
                "album_slug": row.get("album_slug"),
            }
        )
        if len(artwork) >= limit:
            break
    return artwork


def _artwork_artists(rows: list[dict], limit: int = 4) -> list[dict]:
    artwork: list[dict] = []
    seen: set[object] = set()
    for row in rows:
        artist_key = row.get("artist_id") or (row.get("artist") or "").strip().lower()
        if not artist_key or artist_key in seen:
            continue
        seen.add(artist_key)
        artwork.append(
            {
                "artist_name": row.get("artist") or "",
                "artist_id": row.get("artist_id"),
                "artist_slug": row.get("artist_slug"),
            }
        )
        if len(artwork) >= limit:
            break
    return artwork


def _select_diverse_tracks(
    rows: list[dict],
    *,
    limit: int,
    max_per_artist: int = 2,
    max_per_album: int = 2,
) -> list[dict]:
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
    "_album_identity",
    "_artist_identity",
    "_artwork_artists",
    "_artwork_tracks",
    "_coerce_date",
    "_coerce_datetime",
    "_daily_rotation_index",
    "_merge_track_rows",
    "_select_diverse_tracks",
    "_select_diverse_tracks_with_backfill",
    "_track_payload",
    "_trim_bio",
]
