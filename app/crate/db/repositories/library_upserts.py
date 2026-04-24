"""Upsert helpers for library repository writes."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryAlbum, LibraryArtist, LibraryTrack
from crate.db.repositories.library_shared import allocate_unique_slug, coerce_uuid
from crate.db.tx import optional_scope
from crate.slugs import build_album_slug, build_artist_slug, build_track_slug


def update_track_analysis(
    path: str,
    bpm: float | None,
    key: str | None,
    scale: str | None,
    energy: float | None,
    mood: dict | None,
    danceability: float | None = None,
    valence: float | None = None,
    acousticness: float | None = None,
    instrumentalness: float | None = None,
    loudness: float | None = None,
    dynamic_range: float | None = None,
    spectral_complexity: float | None = None,
    *,
    session: Session | None = None,
) -> None:
    def _impl(s: Session) -> None:
        track = s.execute(select(LibraryTrack).where(LibraryTrack.path == path).limit(1)).scalar_one_or_none()
        if track is None:
            return

        track.bpm = bpm
        track.audio_key = key
        track.audio_scale = scale
        track.energy = energy
        track.mood_json = mood
        track.danceability = danceability
        track.valence = valence
        track.acousticness = acousticness
        track.instrumentalness = instrumentalness
        track.loudness = loudness
        track.dynamic_range = dynamic_range
        track.spectral_complexity = spectral_complexity

        s.execute(
            text(
                """
                INSERT INTO track_analysis_features (
                    track_id,
                    bpm,
                    audio_key,
                    audio_scale,
                    energy,
                    mood_json,
                    danceability,
                    valence,
                    acousticness,
                    instrumentalness,
                    loudness,
                    dynamic_range,
                    spectral_complexity,
                    updated_at
                )
                VALUES (
                    :track_id,
                    :bpm,
                    :audio_key,
                    :audio_scale,
                    :energy,
                    CAST(:mood_json AS jsonb),
                    :danceability,
                    :valence,
                    :acousticness,
                    :instrumentalness,
                    :loudness,
                    :dynamic_range,
                    :spectral_complexity,
                    NOW()
                )
                ON CONFLICT (track_id) DO UPDATE SET
                    bpm = EXCLUDED.bpm,
                    audio_key = EXCLUDED.audio_key,
                    audio_scale = EXCLUDED.audio_scale,
                    energy = EXCLUDED.energy,
                    mood_json = EXCLUDED.mood_json,
                    danceability = EXCLUDED.danceability,
                    valence = EXCLUDED.valence,
                    acousticness = EXCLUDED.acousticness,
                    instrumentalness = EXCLUDED.instrumentalness,
                    loudness = EXCLUDED.loudness,
                    dynamic_range = EXCLUDED.dynamic_range,
                    spectral_complexity = EXCLUDED.spectral_complexity,
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {
                "track_id": track.id,
                "bpm": bpm,
                "audio_key": key,
                "audio_scale": scale,
                "energy": energy,
                "mood_json": None if mood is None else json.dumps(mood),
                "danceability": danceability,
                "valence": valence,
                "acousticness": acousticness,
                "instrumentalness": instrumentalness,
                "loudness": loudness,
                "dynamic_range": dynamic_range,
                "spectral_complexity": spectral_complexity,
            },
        )

    with optional_scope(session) as s:
        _impl(s)


def upsert_artist(data: dict, *, session: Session | None = None) -> None:
    def _impl(s: Session) -> None:
        now = datetime.now(timezone.utc)
        existing = s.execute(select(LibraryArtist.slug, LibraryArtist.storage_id).where(LibraryArtist.name == data["name"]).limit(1)).first()
        slug = existing[0] if existing and existing[0] else allocate_unique_slug(s, LibraryArtist, build_artist_slug(data["name"]))
        storage_id = existing[1] if existing and existing[1] else coerce_uuid(data.get("storage_id"))
        insert_stmt = pg_insert(LibraryArtist).values(
            name=data["name"],
            storage_id=storage_id,
            slug=slug,
            folder_name=data.get("folder_name") or data["name"],
            album_count=data.get("album_count", 0),
            track_count=data.get("track_count", 0),
            total_size=data.get("total_size", 0),
            formats_json=list(data.get("formats", [])),
            primary_format=data.get("primary_format"),
            has_photo=data.get("has_photo", 0),
            dir_mtime=data.get("dir_mtime"),
            updated_at=now,
        )
        s.execute(
            insert_stmt.on_conflict_do_update(
                index_elements=[LibraryArtist.name],
                set_={
                    "storage_id": func.coalesce(LibraryArtist.storage_id, insert_stmt.excluded.storage_id),
                    "slug": func.coalesce(LibraryArtist.slug, insert_stmt.excluded.slug),
                    "folder_name": func.coalesce(LibraryArtist.folder_name, insert_stmt.excluded.folder_name),
                    "album_count": insert_stmt.excluded.album_count,
                    "track_count": insert_stmt.excluded.track_count,
                    "total_size": insert_stmt.excluded.total_size,
                    "formats_json": insert_stmt.excluded.formats_json,
                    "primary_format": insert_stmt.excluded.primary_format,
                    "has_photo": insert_stmt.excluded.has_photo,
                    "dir_mtime": insert_stmt.excluded.dir_mtime,
                    "updated_at": insert_stmt.excluded.updated_at,
                },
            )
        )

    with optional_scope(session) as s:
        _impl(s)


def upsert_album(data: dict, *, session: Session | None = None) -> int:
    def _impl(s: Session) -> int:
        now = datetime.now(timezone.utc)
        existing = s.execute(select(LibraryAlbum.slug, LibraryAlbum.storage_id).where(LibraryAlbum.path == data["path"]).limit(1)).first()
        slug = existing[0] if existing and existing[0] else allocate_unique_slug(s, LibraryAlbum, build_album_slug(data["artist"], data["name"]))
        storage_id = existing[1] if existing and existing[1] else coerce_uuid(data.get("storage_id"))
        insert_stmt = pg_insert(LibraryAlbum).values(
            storage_id=storage_id,
            artist=data["artist"],
            name=data["name"],
            slug=slug,
            path=data["path"],
            track_count=data.get("track_count", 0),
            total_size=data.get("total_size", 0),
            total_duration=data.get("total_duration", 0),
            formats_json=list(data.get("formats", [])),
            year=data.get("year"),
            genre=data.get("genre"),
            has_cover=data.get("has_cover", 0),
            musicbrainz_albumid=data.get("musicbrainz_albumid"),
            tag_album=data.get("tag_album"),
            dir_mtime=data.get("dir_mtime"),
            updated_at=now,
        )
        s.execute(
            insert_stmt.on_conflict_do_update(
                index_elements=[LibraryAlbum.path],
                set_={
                    "storage_id": func.coalesce(LibraryAlbum.storage_id, insert_stmt.excluded.storage_id),
                    "artist": insert_stmt.excluded.artist,
                    "name": insert_stmt.excluded.name,
                    "slug": func.coalesce(LibraryAlbum.slug, insert_stmt.excluded.slug),
                    "track_count": insert_stmt.excluded.track_count,
                    "total_size": insert_stmt.excluded.total_size,
                    "total_duration": insert_stmt.excluded.total_duration,
                    "formats_json": insert_stmt.excluded.formats_json,
                    "year": insert_stmt.excluded.year,
                    "genre": insert_stmt.excluded.genre,
                    "has_cover": insert_stmt.excluded.has_cover,
                    "musicbrainz_albumid": func.coalesce(
                        func.nullif(insert_stmt.excluded.musicbrainz_albumid, ""),
                        LibraryAlbum.musicbrainz_albumid,
                    ),
                    "tag_album": func.coalesce(insert_stmt.excluded.tag_album, LibraryAlbum.tag_album),
                    "dir_mtime": insert_stmt.excluded.dir_mtime,
                    "updated_at": insert_stmt.excluded.updated_at,
                },
            )
        )
        row = s.execute(select(LibraryAlbum.id).where(LibraryAlbum.path == data["path"]).limit(1)).scalar_one()
        return int(row)

    with optional_scope(session) as s:
        return _impl(s)


def upsert_track(data: dict, *, session: Session | None = None) -> None:
    def _impl(s: Session) -> None:
        now = datetime.now(timezone.utc)
        existing = s.execute(select(LibraryTrack.slug, LibraryTrack.storage_id).where(LibraryTrack.path == data["path"]).limit(1)).first()
        slug = (
            existing[0]
            if existing and existing[0]
            else allocate_unique_slug(s, LibraryTrack, build_track_slug(data["artist"], data.get("title"), data.get("filename")))
        )
        storage_id = existing[1] if existing and existing[1] else coerce_uuid(data.get("storage_id"))
        insert_stmt = pg_insert(LibraryTrack).values(
            storage_id=storage_id,
            album_id=data.get("album_id"),
            artist=data["artist"],
            album=data["album"],
            slug=slug,
            filename=data["filename"],
            title=data.get("title"),
            track_number=data.get("track_number"),
            disc_number=data.get("disc_number", 1),
            format=data.get("format"),
            bitrate=data.get("bitrate"),
            sample_rate=data.get("sample_rate"),
            bit_depth=data.get("bit_depth"),
            duration=data.get("duration"),
            size=data.get("size"),
            year=data.get("year"),
            genre=data.get("genre"),
            albumartist=data.get("albumartist"),
            musicbrainz_albumid=data.get("musicbrainz_albumid"),
            musicbrainz_trackid=data.get("musicbrainz_trackid"),
            path=data["path"],
            updated_at=now,
        )
        s.execute(
            insert_stmt.on_conflict_do_update(
                index_elements=[LibraryTrack.path],
                set_={
                    "storage_id": func.coalesce(LibraryTrack.storage_id, insert_stmt.excluded.storage_id),
                    "album_id": insert_stmt.excluded.album_id,
                    "artist": insert_stmt.excluded.artist,
                    "album": insert_stmt.excluded.album,
                    "slug": func.coalesce(LibraryTrack.slug, insert_stmt.excluded.slug),
                    "filename": insert_stmt.excluded.filename,
                    "title": insert_stmt.excluded.title,
                    "track_number": insert_stmt.excluded.track_number,
                    "disc_number": insert_stmt.excluded.disc_number,
                    "format": insert_stmt.excluded.format,
                    "bitrate": insert_stmt.excluded.bitrate,
                    "sample_rate": insert_stmt.excluded.sample_rate,
                    "bit_depth": insert_stmt.excluded.bit_depth,
                    "duration": insert_stmt.excluded.duration,
                    "size": insert_stmt.excluded.size,
                    "year": insert_stmt.excluded.year,
                    "genre": insert_stmt.excluded.genre,
                    "albumartist": insert_stmt.excluded.albumartist,
                    "musicbrainz_albumid": func.coalesce(
                        func.nullif(insert_stmt.excluded.musicbrainz_albumid, ""),
                        LibraryTrack.musicbrainz_albumid,
                    ),
                    "musicbrainz_trackid": func.coalesce(
                        func.nullif(insert_stmt.excluded.musicbrainz_trackid, ""),
                        LibraryTrack.musicbrainz_trackid,
                    ),
                    "updated_at": insert_stmt.excluded.updated_at,
                },
            )
        )

        track_id = int(s.execute(select(LibraryTrack.id).where(LibraryTrack.path == data["path"]).limit(1)).scalar_one())
        ensure_track_processing_rows(s, track_id)

    with optional_scope(session) as s:
        _impl(s)


def ensure_track_processing_rows(session: Session, track_id: int) -> None:
    session.execute(
        text(
            """
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
                lt.id,
                'analysis',
                COALESCE(NULLIF(lt.analysis_state, ''), 'pending'),
                NULL,
                NULL,
                0,
                NULL,
                NOW(),
                CASE
                    WHEN COALESCE(NULLIF(lt.analysis_state, ''), 'pending') = 'done'
                    THEN COALESCE(lt.analysis_completed_at, lt.updated_at, NOW())
                    ELSE NULL
                END
            FROM library_tracks lt
            WHERE lt.id = :track_id
            ON CONFLICT (track_id, pipeline) DO NOTHING
            """
        ),
        {"track_id": track_id},
    )
    session.execute(
        text(
            """
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
                lt.id,
                'bliss',
                COALESCE(NULLIF(lt.bliss_state, ''), 'pending'),
                NULL,
                NULL,
                0,
                NULL,
                NOW(),
                CASE
                    WHEN COALESCE(NULLIF(lt.bliss_state, ''), 'pending') = 'done'
                    THEN COALESCE(lt.bliss_computed_at, lt.updated_at, NOW())
                    ELSE NULL
                END
            FROM library_tracks lt
            WHERE lt.id = :track_id
            ON CONFLICT (track_id, pipeline) DO NOTHING
            """
        ),
        {"track_id": track_id},
    )


__all__ = [
    "ensure_track_processing_rows",
    "update_track_analysis",
    "upsert_album",
    "upsert_artist",
    "upsert_track",
]
