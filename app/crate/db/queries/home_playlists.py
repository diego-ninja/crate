from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_recent_playlist_rows_with_artwork(user_id: int, limit: int) -> list[dict]:
    with read_scope() as session:
        playlist_rows = [
            dict(row)
            for row in session.execute(
                text(
                    """
                    SELECT *
                    FROM (
                        SELECT DISTINCT ON (upe.context_playlist_id)
                            p.id AS playlist_id,
                            p.name,
                            p.description,
                            p.scope,
                            p.cover_data_url,
                            upe.ended_at AS played_at
                        FROM user_play_events upe
                        JOIN playlists p ON p.id = upe.context_playlist_id
                        WHERE upe.user_id = :user_id
                          AND upe.context_playlist_id IS NOT NULL
                        ORDER BY upe.context_playlist_id ASC, upe.ended_at DESC
                    ) recent
                    ORDER BY recent.played_at DESC
                    LIMIT :lim
                    """
                ),
                {"user_id": user_id, "lim": limit},
            ).mappings().all()
        ]
        playlist_ids = [row["playlist_id"] for row in playlist_rows if row.get("playlist_id") is not None]
        artwork_rows = session.execute(
            text(
                """
                SELECT
                    pt.playlist_id,
                    lt.artist,
                    art.id AS artist_id,
                    art.entity_uid::text AS artist_entity_uid,
                    art.slug AS artist_slug,
                    lt.album,
                    alb.id AS album_id,
                    alb.entity_uid::text AS album_entity_uid,
                    alb.slug AS album_slug
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
                    WHERE pt.playlist_id = ANY(:playlist_ids)
                ) pt
                JOIN library_tracks lt
                  ON lt.id = pt.resolved_track_id
                 AND (lt.entity_uid IS NOT NULL OR lt.storage_id IS NOT NULL)
                LEFT JOIN library_artists art ON art.name = lt.artist
                LEFT JOIN library_albums alb ON alb.id = lt.album_id
                ORDER BY pt.playlist_id ASC, pt.position ASC
                """
            ),
            {"playlist_ids": playlist_ids or [0]},
        ).mappings().all()

    artwork_map: dict[int, list[dict]] = {}
    for row in artwork_rows:
        playlist_id = int(row["playlist_id"])
        bucket = artwork_map.setdefault(playlist_id, [])
        if len(bucket) >= 4:
            continue
        bucket.append(
            {
                "artist": row.get("artist"),
                "artist_id": row.get("artist_id"),
                "artist_entity_uid": (
                    str(row["artist_entity_uid"]) if row.get("artist_entity_uid") is not None else None
                ),
                "artist_slug": row.get("artist_slug"),
                "album": row.get("album"),
                "album_id": row.get("album_id"),
                "album_entity_uid": (
                    str(row["album_entity_uid"]) if row.get("album_entity_uid") is not None else None
                ),
                "album_slug": row.get("album_slug"),
            }
        )

    return [
        {
            "type": "playlist",
            "playlist_id": row.get("playlist_id"),
            "playlist_name": row.get("name") or "",
            "playlist_description": row.get("description") or "",
            "playlist_scope": row.get("scope") or "user",
            "playlist_cover_data_url": row.get("cover_data_url"),
            "playlist_tracks": artwork_map.get(int(row.get("playlist_id") or 0), []),
            "subtitle": "Playlist" if row.get("scope") != "system" else "Mix",
            "played_at": row.get("played_at"),
        }
        for row in playlist_rows
    ]


__all__ = ["get_recent_playlist_rows_with_artwork"]
