"""Backfill helpers for track audio fingerprints."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import transaction_scope


def list_tracks_missing_audio_fingerprints(*, limit: int = 1000) -> list[dict]:
    capped_limit = max(1, min(int(limit or 1000), 50_000))
    with transaction_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    id,
                    entity_uid::text AS entity_uid,
                    storage_id::text AS storage_id,
                    path,
                    artist,
                    album,
                    title
                FROM library_tracks
                WHERE audio_fingerprint IS NULL
                  AND path IS NOT NULL
                  AND path != ''
                ORDER BY id ASC
                LIMIT :limit
                """
            ),
            {"limit": capped_limit},
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
