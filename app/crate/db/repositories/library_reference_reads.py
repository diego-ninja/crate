"""Reference and analysis read helpers for the library repository."""

from __future__ import annotations

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryAlbum, LibraryArtist, LibraryTrack
from crate.db.tx import read_scope


def get_artist_analysis_tracks(artist_name: str, *, session: Session | None = None) -> list[dict]:
    def _impl(s: Session) -> list[dict]:
        rows = s.execute(
            text(
                """
                SELECT t.title,
                       t.bpm AS tempo,
                       t.audio_key AS key,
                       t.audio_scale AS scale,
                       t.energy,
                       t.danceability,
                       t.valence,
                       t.acousticness,
                       t.instrumentalness,
                       t.loudness,
                       t.dynamic_range,
                       t.spectral_complexity,
                       t.mood_json
                FROM library_tracks t
                JOIN library_albums a ON t.album_id = a.id
                WHERE a.artist = :artist_name AND t.bpm IS NOT NULL
                """
            ),
            {"artist_name": artist_name},
        ).mappings().all()
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_artist_refs_by_names(names: list[str], *, session: Session | None = None) -> dict[str, dict]:
    if not names:
        return {}

    lowered = [name.lower() for name in names]

    def _impl(s: Session) -> dict[str, dict]:
        rows = s.execute(
            select(LibraryArtist.id, LibraryArtist.slug, LibraryArtist.name).where(func.lower(LibraryArtist.name).in_(lowered))
        ).all()
        return {row.name.lower(): {"id": row.id, "slug": row.slug} for row in rows}

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_artist_tracks_for_setlist(artist_name: str, *, session: Session | None = None) -> list[dict]:
    def _impl(s: Session) -> list[dict]:
        rows = s.execute(
            text(
                """
                SELECT
                    t.id,
                    t.title,
                    t.path,
                    t.duration,
                    a.name AS album
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                WHERE a.artist = :artist_name
                ORDER BY a.year NULLS LAST, a.name, t.disc_number NULLS LAST, t.track_number NULLS LAST, t.title
                """
            ),
            {"artist_name": artist_name},
        ).mappings().all()
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def find_user_playlist_by_name(user_id: int, playlist_name: str, *, session: Session | None = None) -> dict | None:
    def _impl(s: Session) -> dict | None:
        row = s.execute(
            text(
                """
                SELECT id
                FROM playlists
                WHERE user_id = :user_id
                  AND scope = 'user'
                  AND name = :playlist_name
                ORDER BY updated_at DESC NULLS LAST, id DESC
                LIMIT 1
                """
            ),
            {"user_id": user_id, "playlist_name": playlist_name},
        ).mappings().first()
        return dict(row) if row else None

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def enrich_track_refs(track_ids: list[int], *, session: Session | None = None) -> dict[int, dict]:
    if not track_ids:
        return {}

    def _impl(s: Session) -> dict[int, dict]:
        rows = s.execute(
            select(
                LibraryTrack.id.label("track_id"),
                LibraryTrack.entity_uid.label("track_entity_uid"),
                LibraryTrack.slug.label("track_slug"),
                LibraryAlbum.id.label("album_id"),
                LibraryAlbum.entity_uid.label("album_entity_uid"),
                LibraryAlbum.slug.label("album_slug"),
                LibraryArtist.id.label("artist_id"),
                LibraryArtist.entity_uid.label("artist_entity_uid"),
                LibraryArtist.slug.label("artist_slug"),
            )
            .join(LibraryAlbum, LibraryTrack.album_id == LibraryAlbum.id)
            .outerjoin(LibraryArtist, LibraryArtist.name == LibraryAlbum.artist)
            .where(LibraryTrack.id.in_(track_ids))
        ).mappings().all()
        return {
            row["track_id"]: {
                **dict(row),
                "track_entity_uid": str(row["track_entity_uid"]) if row.get("track_entity_uid") is not None else None,
                "album_entity_uid": str(row["album_entity_uid"]) if row.get("album_entity_uid") is not None else None,
                "artist_entity_uid": str(row["artist_entity_uid"]) if row.get("artist_entity_uid") is not None else None,
            }
            for row in rows
        }

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


__all__ = [
    "enrich_track_refs",
    "find_user_playlist_by_name",
    "get_artist_analysis_tracks",
    "get_artist_refs_by_names",
    "get_artist_tracks_for_setlist",
]
