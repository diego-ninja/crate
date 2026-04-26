from __future__ import annotations


def requeue_filter_clauses(
    *,
    track_id: int | None,
    album_id: int | None,
    artist: str | None,
    album_name: str | None,
    scope: str | None,
) -> str:
    if track_id:
        return "id = :track_id"
    if album_id:
        return "album_id = :album_id"
    if artist and album_name:
        return "album_id IN (SELECT id FROM library_albums WHERE artist = :artist AND name = :album_name)"
    if artist:
        return "album_id IN (SELECT id FROM library_albums WHERE artist = :artist)"
    if scope == "all":
        return "TRUE"
    return "FALSE"


def requeue_filter_params(
    track_id: int | None,
    album_id: int | None,
    artist: str | None,
    album_name: str | None,
) -> dict:
    return {
        "track_id": track_id,
        "album_id": album_id,
        "artist": artist,
        "album_name": album_name,
    }


__all__ = [
    "requeue_filter_clauses",
    "requeue_filter_params",
]
