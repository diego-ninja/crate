"""Backfill helpers for track audio fingerprints."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import transaction_scope


def list_tracks_missing_audio_fingerprints(
    *,
    limit: int = 1000,
    track_id: int | None = None,
    artist: str | None = None,
    album: str | None = None,
    album_id: int | None = None,
) -> list[dict]:
    capped_limit = max(1, min(int(limit or 1000), 50_000))
    filters = [
        "audio_fingerprint IS NULL",
        "path IS NOT NULL",
        "path != ''",
    ]
    params: dict[str, object] = {"limit": capped_limit}
    if track_id:
        filters.append("id = :track_id")
        params["track_id"] = int(track_id)
    if album_id:
        filters.append("album_id = :album_id")
        params["album_id"] = int(album_id)
    if artist:
        filters.append("lower(artist) = lower(:artist)")
        params["artist"] = artist
    if album:
        filters.append("lower(album) = lower(:album)")
        params["album"] = album
    where_sql = " AND ".join(filters)
    with transaction_scope() as session:
        rows = session.execute(
            text(
                f"""
                SELECT
                    id,
                    entity_uid::text AS entity_uid,
                    storage_id::text AS storage_id,
                    path,
                    artist,
                    album,
                    title
                FROM library_tracks
                WHERE {where_sql}
                ORDER BY id ASC
                LIMIT :limit
                """
            ),
            params,
        ).mappings().all()
        return [dict(row) for row in rows]


def store_track_audio_fingerprint(
    track_id: int,
    *,
    fingerprint: str,
    fingerprint_source: str,
) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE library_tracks
                SET
                    audio_fingerprint = :fingerprint,
                    audio_fingerprint_source = :fingerprint_source,
                    audio_fingerprint_computed_at = NOW()
                WHERE id = :track_id
                """
            ),
            {
                "track_id": track_id,
                "fingerprint": fingerprint,
                "fingerprint_source": fingerprint_source,
            },
        )


__all__ = [
    "list_tracks_missing_audio_fingerprints",
    "store_track_audio_fingerprint",
]
