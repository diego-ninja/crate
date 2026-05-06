"""Seed-building queries for the shaped radio engine."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_track_seed(track_ref: str) -> tuple[list[float], str] | None:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT
                    bliss_vector,
                    title,
                    artist
                FROM library_tracks
                WHERE bliss_vector IS NOT NULL
                  AND (
                    CAST(id AS text) = :track_ref
                    OR (entity_uid IS NOT NULL AND CAST(entity_uid AS text) = :track_ref)
                    OR (storage_id IS NOT NULL AND CAST(storage_id AS text) = :track_ref)
                    OR path = :track_ref
                  )
                ORDER BY
                  CASE
                    WHEN CAST(id AS text) = :track_ref THEN 0
                    WHEN entity_uid IS NOT NULL AND CAST(entity_uid AS text) = :track_ref THEN 1
                    WHEN storage_id IS NOT NULL AND CAST(storage_id AS text) = :track_ref THEN 2
                    WHEN path = :track_ref THEN 3
                    ELSE 4
                  END
                LIMIT 1
                """
            ),
            {"track_ref": track_ref},
        ).mappings().first()
    if not row:
        return None
    return list(row["bliss_vector"]), f"{row['title']} — {row['artist']}"


def get_playlist_seed(playlist_id: int, limit: int = 30) -> tuple[list[list[float]], str] | None:
    with read_scope() as session:
        playlist = session.execute(
            text("SELECT name FROM playlists WHERE id = :playlist_id"),
            {"playlist_id": playlist_id},
        ).mappings().first()
        if not playlist:
            return None

        rows = session.execute(
            text(
                """
                SELECT lt.bliss_vector
                FROM (
                    SELECT
                        pt.*,
                        COALESCE(lt_id.id, lt_entity.id, lt_storage.id, lt_path.id) AS resolved_track_id
                    FROM playlist_tracks pt
                    LEFT JOIN library_tracks lt_id
                      ON lt_id.id = pt.track_id
                    LEFT JOIN library_tracks lt_entity
                      ON lt_id.id IS NULL
                     AND pt.track_entity_uid IS NOT NULL
                     AND lt_entity.entity_uid = pt.track_entity_uid
                    LEFT JOIN library_tracks lt_storage
                      ON lt_id.id IS NULL
                     AND lt_entity.id IS NULL
                     AND pt.track_storage_id IS NOT NULL
                     AND lt_storage.storage_id = pt.track_storage_id
                    LEFT JOIN library_tracks lt_path
                      ON lt_id.id IS NULL
                     AND lt_entity.id IS NULL
                     AND lt_storage.id IS NULL
                     AND pt.track_path IS NOT NULL
                     AND lt_path.path = pt.track_path
                    WHERE pt.playlist_id = :playlist_id
                ) pt
                JOIN library_tracks lt
                  ON lt.id = pt.resolved_track_id
                 AND (lt.entity_uid IS NOT NULL OR lt.storage_id IS NOT NULL)
                WHERE lt.bliss_vector IS NOT NULL
                ORDER BY pt.position
                LIMIT :limit
                """
            ),
            {"playlist_id": playlist_id, "limit": limit},
        ).mappings().all()

    vectors = [list(row["bliss_vector"]) for row in rows]
    if not vectors:
        return None
    return vectors, str(playlist["name"])


def get_home_playlist_seed(user_id: int, playlist_id: str, limit: int = 30) -> tuple[list[list[float]], str] | None:
    from crate.db.home import get_home_playlist

    playlist = get_home_playlist(user_id, playlist_id, limit=max(limit, 40))
    if not playlist:
        return None

    vectors: list[list[float]] = []
    for track in playlist.get("tracks") or []:
        track_ref = (
            str(track.get("track_id"))
            if track.get("track_id") is not None
            else str(track.get("track_entity_uid") or track.get("track_storage_id") or track.get("track_path") or "")
        )
        if not track_ref:
            continue
        resolved = get_track_seed(track_ref)
        if not resolved:
            continue
        vector, _label = resolved
        vectors.append(vector)
        if len(vectors) >= limit:
            break

    if not vectors:
        return None
    return vectors, str(playlist.get("name") or playlist_id)


__all__ = [
    "get_home_playlist_seed",
    "get_playlist_seed",
    "get_track_seed",
]
