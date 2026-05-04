from __future__ import annotations

from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope


def list_tracks_for_lyrics(
    *,
    artist: str | None = None,
    album_id: int | None = None,
    album_entity_uid: str | None = None,
    track_id: int | None = None,
    track_entity_uid: str | None = None,
    limit: int = 500,
    only_missing: bool = True,
) -> list[dict[str, Any]]:
    safe_limit = min(max(int(limit or 500), 1), 5000)
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    lt.id,
                    lt.entity_uid,
                    lt.artist,
                    lt.album,
                    lt.album_id,
                    lt.title,
                    lt.filename,
                    lt.path,
                    lt.disc_number,
                    lt.track_number
                FROM library_tracks lt
                WHERE (:artist IS NULL OR lower(lt.artist) = lower(:artist))
                  AND (:album_id IS NULL OR lt.album_id = :album_id)
                  AND (
                      :album_entity_uid IS NULL
                      OR lt.album_id IN (
                          SELECT id
                          FROM library_albums
                          WHERE entity_uid::text = :album_entity_uid
                      )
                  )
                  AND (:track_id IS NULL OR lt.id = :track_id)
                  AND (:track_entity_uid IS NULL OR lt.entity_uid::text = :track_entity_uid)
                  AND (
                      :only_missing = FALSE
                      OR NOT EXISTS (
                          SELECT 1
                          FROM track_lyrics lyr
                          WHERE lyr.provider = 'lrclib'
                            AND (
                                lyr.track_id = lt.id
                                OR (
                                    lyr.track_id IS NULL
                                    AND lyr.artist_key = lower(regexp_replace(trim(lt.artist), '\\s+', ' ', 'g'))
                                    AND lyr.title_key = lower(
                                        regexp_replace(
                                            trim(COALESCE(NULLIF(lt.title, ''), lt.filename)),
                                            '\\s+',
                                            ' ',
                                            'g'
                                        )
                                    )
                                )
                            )
                      )
                  )
                ORDER BY
                    lt.artist,
                    lt.album,
                    COALESCE(lt.disc_number, 1),
                    COALESCE(lt.track_number, 9999),
                    lt.filename,
                    lt.id
                LIMIT :limit
                """
            ),
            {
                "artist": artist,
                "album_id": album_id,
                "album_entity_uid": album_entity_uid,
                "track_id": track_id,
                "track_entity_uid": track_entity_uid,
                "only_missing": only_missing,
                "limit": safe_limit,
            },
        ).mappings().all()
    return [dict(row) for row in rows]


def get_album_track_lyrics_status(album_id: int) -> dict[int, dict[str, Any]]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    lt.id AS track_id,
                    lt.entity_uid AS track_entity_uid,
                    lyr.provider,
                    COALESCE(lyr.found, FALSE) AS found,
                    COALESCE(NULLIF(lyr.plain_lyrics, ''), '') <> '' AS has_plain,
                    COALESCE(NULLIF(lyr.synced_lyrics, ''), '') <> '' AS has_synced,
                    lyr.updated_at,
                    CASE
                        WHEN COALESCE(NULLIF(lyr.synced_lyrics, ''), '') <> '' THEN 'synced'
                        WHEN COALESCE(NULLIF(lyr.plain_lyrics, ''), '') <> '' THEN 'txt'
                        ELSE 'none'
                    END AS status
                FROM library_tracks lt
                LEFT JOIN LATERAL (
                    SELECT provider, found, synced_lyrics, plain_lyrics, updated_at
                    FROM track_lyrics l
                    WHERE l.provider = 'lrclib'
                      AND (
                          l.track_id = lt.id
                          OR (
                              l.track_id IS NULL
                              AND l.artist_key = lower(regexp_replace(trim(lt.artist), '\\s+', ' ', 'g'))
                              AND l.title_key = lower(
                                  regexp_replace(
                                      trim(COALESCE(NULLIF(lt.title, ''), lt.filename)),
                                      '\\s+',
                                      ' ',
                                      'g'
                                  )
                              )
                          )
                      )
                    ORDER BY CASE WHEN l.track_id = lt.id THEN 0 ELSE 1 END, l.updated_at DESC
                    LIMIT 1
                ) lyr ON TRUE
                WHERE lt.album_id = :album_id
                """
            ),
            {"album_id": album_id},
        ).mappings().all()

    return {
        int(row["track_id"]): {
            "status": row.get("status") or "none",
            "found": bool(row.get("found")),
            "has_plain": bool(row.get("has_plain")),
            "has_synced": bool(row.get("has_synced")),
            "provider": row.get("provider") or "lrclib",
            "updated_at": row.get("updated_at"),
        }
        for row in rows
    }


__all__ = ["get_album_track_lyrics_status", "list_tracks_for_lyrics"]
