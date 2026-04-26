from __future__ import annotations


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


__all__ = [
    "_artwork_artists",
    "_artwork_tracks",
    "_track_payload",
]
