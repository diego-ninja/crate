"""Track queries for the Subsonic API."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_tracks_by_album_id(album_id: int) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT id, title, artist, album, path, duration,
                       COALESCE(track_number, 0) as track,
                       COALESCE(disc_number, 1) as disc,
                       format, bitrate, sample_rate
                FROM library_tracks
                WHERE album_id = :album_id
                ORDER BY disc_number, track_number
                """
            ),
            {"album_id": album_id},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_track_full(track_id: int) -> dict | None:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT t.id, t.title, t.artist, t.album, t.path, t.duration,
                       t.track_number, t.disc_number, t.format, t.bitrate,
                       a.id as album_id, a.has_cover, a.year,
                       ar.id as artist_id
                FROM library_tracks t
                LEFT JOIN library_albums a ON a.id = t.album_id
                LEFT JOIN library_artists ar ON ar.name = t.artist
                WHERE t.id = :track_id
                """
            ),
            {"track_id": track_id},
        ).mappings().first()
    return dict(row) if row else None


def get_track_path_and_format(track_id: int) -> dict | None:
    with read_scope() as session:
        row = session.execute(
            text("SELECT path, format FROM library_tracks WHERE id = :track_id"),
            {"track_id": track_id},
        ).mappings().first()
    return dict(row) if row else None


def get_track_basic(track_id: int) -> dict | None:
    with read_scope() as session:
        row = session.execute(
            text("SELECT title, artist, album FROM library_tracks WHERE id = :track_id"),
            {"track_id": track_id},
        ).mappings().first()
    return dict(row) if row else None


def get_random_tracks(size: int) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT t.id, t.title, t.artist, t.album, t.duration, t.path,
                       t.format, t.bitrate, t.track_number, t.disc_number,
                       a.id as album_id, a.has_cover, a.year, ar.id as artist_id
                FROM library_tracks t
                LEFT JOIN library_albums a ON a.id = t.album_id
                LEFT JOIN library_artists ar ON ar.name = t.artist
                ORDER BY RANDOM()
                LIMIT :size
                """
            ),
            {"size": size},
        ).mappings().all()
    return [dict(row) for row in rows]


__all__ = [
    "get_random_tracks",
    "get_track_basic",
    "get_track_full",
    "get_track_path_and_format",
    "get_tracks_by_album_id",
]
