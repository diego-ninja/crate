"""Popularity and requeue helpers used by worker analysis handlers."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.jobs.analysis_shared import (
    append_pipeline_event,
    mark_ops_snapshot_dirty,
    requeue_filter_clauses,
    requeue_filter_params,
)
from crate.db.tx import transaction_scope


def get_albums_needing_popularity(artist_name: str) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text(
                "SELECT id, name, tag_album FROM library_albums "
                "WHERE artist = :artist AND lastfm_listeners IS NULL"
            ),
            {"artist": artist_name},
        ).mappings().all()
        return [dict(row) for row in rows]


def update_album_popularity(album_id: int, listeners: int, playcount: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_albums SET lastfm_listeners = :listeners, lastfm_playcount = :playcount "
                "WHERE id = :id"
            ),
            {"listeners": listeners, "playcount": playcount, "id": album_id},
        )


def get_tracks_needing_popularity(artist_name: str, limit: int = 50) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text(
                "SELECT t.id, t.title FROM library_tracks t "
                "JOIN library_albums a ON t.album_id = a.id "
                "WHERE a.artist = :artist AND t.lastfm_listeners IS NULL "
                "AND t.title IS NOT NULL AND t.title != '' LIMIT :lim"
            ),
            {"artist": artist_name, "lim": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


def update_track_popularity(track_id: int, listeners: int, playcount: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET lastfm_listeners = :listeners, lastfm_playcount = :playcount "
                "WHERE id = :id"
            ),
            {"listeners": listeners, "playcount": playcount, "id": track_id},
        )


def requeue_tracks(
    set_clause: str,
    track_id: int | None = None,
    album_id: int | None = None,
    artist: str | None = None,
    album_name: str | None = None,
    scope: str | None = None,
    pipelines: list[str] | None = None,
) -> int:
    with transaction_scope() as session:
        if track_id:
            result = session.execute(text(f"UPDATE library_tracks SET {set_clause} WHERE id = :id"), {"id": track_id})
        elif album_id:
            result = session.execute(
                text(f"UPDATE library_tracks SET {set_clause} WHERE album_id = :album_id"),
                {"album_id": album_id},
            )
        elif artist and album_name:
            result = session.execute(
                text(
                    f"UPDATE library_tracks SET {set_clause} WHERE album_id IN "
                    "(SELECT id FROM library_albums WHERE artist = :artist AND name = :album_name)"
                ),
                {"artist": artist, "album_name": album_name},
            )
        elif artist:
            result = session.execute(
                text(
                    f"UPDATE library_tracks SET {set_clause} WHERE album_id IN "
                    "(SELECT id FROM library_albums WHERE artist = :artist)"
                ),
                {"artist": artist},
            )
        elif scope == "all":
            result = session.execute(text(f"UPDATE library_tracks SET {set_clause}"))
        else:
            return 0

        if result.rowcount and pipelines:
            filters = requeue_filter_clauses(
                track_id=track_id,
                album_id=album_id,
                artist=artist,
                album_name=album_name,
                scope=scope,
            )
            for pipeline in pipelines:
                session.execute(
                    text(
                        f"""
                        INSERT INTO track_processing_state (
                            track_id,
                            pipeline,
                            state,
                            claimed_by,
                            claimed_at,
                            attempts,
                            last_error,
                            updated_at,
                            completed_at
                        )
                        SELECT
                            id,
                            :pipeline,
                            'pending',
                            NULL,
                            NULL,
                            0,
                            NULL,
                            NOW(),
                            NULL
                        FROM library_tracks
                        WHERE {filters}
                        ON CONFLICT (track_id, pipeline) DO UPDATE SET
                            state = 'pending',
                            claimed_by = NULL,
                            claimed_at = NULL,
                            last_error = NULL,
                            updated_at = NOW(),
                            completed_at = NULL
                        """
                    ),
                    {"pipeline": pipeline, **requeue_filter_params(track_id, album_id, artist, album_name)},
                )
                append_pipeline_event(session, pipeline=pipeline, track_id=track_id, state="pending")
            mark_ops_snapshot_dirty(session)
        return int(result.rowcount or 0)


__all__ = [
    "get_albums_needing_popularity",
    "get_tracks_needing_popularity",
    "requeue_tracks",
    "update_album_popularity",
    "update_track_popularity",
]
