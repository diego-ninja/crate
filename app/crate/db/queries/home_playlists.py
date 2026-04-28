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
                    art.slug AS artist_slug,
                    lt.album,
                    alb.id AS album_id,
                    alb.slug AS album_slug
                FROM playlist_tracks pt
                LEFT JOIN LATERAL (
                    SELECT id, artist, album, album_id
                    FROM library_tracks lt
                    WHERE lt.id = pt.track_id
                       OR (pt.track_id IS NULL AND lt.path = pt.track_path)
                    ORDER BY CASE WHEN lt.id = pt.track_id THEN 0 ELSE 1 END
                    LIMIT 1
                ) lt ON TRUE
                LEFT JOIN library_artists art ON art.name = lt.artist
                LEFT JOIN library_albums alb ON alb.id = lt.album_id
                WHERE pt.playlist_id = ANY(:playlist_ids) AND lt.id IS NOT NULL
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
                "artist_slug": row.get("artist_slug"),
                "album": row.get("album"),
                "album_id": row.get("album_id"),
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
