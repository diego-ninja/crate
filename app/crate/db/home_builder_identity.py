from __future__ import annotations


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


__all__ = [
    "_album_identity",
    "_artist_identity",
]
