from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import text

from crate.db.repositories.library_upserts import upsert_album, upsert_artist, upsert_track
from crate.db.repositories.lyrics import store_lyrics
from crate.db.tx import read_scope, transaction_scope


def mark_album_portable_metadata(
    *,
    album_id: int | None,
    album_entity_uid: str | None = None,
    sidecar_path: str | None = None,
    tracks: int = 0,
    tags_written: int = 0,
    tag_errors: int = 0,
    wrote_sidecar: bool = False,
    wrote_audio_tags: bool = False,
) -> None:
    if album_id is None:
        return

    now = datetime.now(timezone.utc)
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO album_portable_metadata (
                    album_id,
                    album_entity_uid,
                    sidecar_path,
                    sidecar_written_at,
                    audio_tags_written_at,
                    tracks,
                    tags_written,
                    tag_errors,
                    updated_at
                )
                VALUES (
                    :album_id,
                    CAST(:album_entity_uid AS UUID),
                    :sidecar_path,
                    :sidecar_written_at,
                    :audio_tags_written_at,
                    :tracks,
                    :tags_written,
                    :tag_errors,
                    :updated_at
                )
                ON CONFLICT (album_id) DO UPDATE SET
                    album_entity_uid = COALESCE(EXCLUDED.album_entity_uid, album_portable_metadata.album_entity_uid),
                    sidecar_path = COALESCE(EXCLUDED.sidecar_path, album_portable_metadata.sidecar_path),
                    sidecar_written_at = COALESCE(EXCLUDED.sidecar_written_at, album_portable_metadata.sidecar_written_at),
                    audio_tags_written_at = COALESCE(EXCLUDED.audio_tags_written_at, album_portable_metadata.audio_tags_written_at),
                    tracks = EXCLUDED.tracks,
                    tags_written = EXCLUDED.tags_written,
                    tag_errors = EXCLUDED.tag_errors,
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {
                "album_id": album_id,
                "album_entity_uid": str(album_entity_uid) if album_entity_uid else None,
                "sidecar_path": sidecar_path,
                "sidecar_written_at": now if wrote_sidecar else None,
                "audio_tags_written_at": now if wrote_audio_tags else None,
                "tracks": int(tracks or 0),
                "tags_written": int(tags_written or 0),
                "tag_errors": int(tag_errors or 0),
                "updated_at": now,
            },
        )


def mark_album_rich_export(
    *,
    album_id: int | None,
    album_entity_uid: str | None = None,
    export_path: str | None,
    tracks: int = 0,
) -> None:
    if album_id is None:
        return

    now = datetime.now(timezone.utc)
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO album_portable_metadata (
                    album_id,
                    album_entity_uid,
                    tracks,
                    export_path,
                    exported_at,
                    updated_at
                )
                VALUES (
                    :album_id,
                    CAST(:album_entity_uid AS UUID),
                    :tracks,
                    :export_path,
                    :exported_at,
                    :updated_at
                )
                ON CONFLICT (album_id) DO UPDATE SET
                    album_entity_uid = COALESCE(EXCLUDED.album_entity_uid, album_portable_metadata.album_entity_uid),
                    tracks = GREATEST(album_portable_metadata.tracks, EXCLUDED.tracks),
                    export_path = EXCLUDED.export_path,
                    exported_at = EXCLUDED.exported_at,
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {
                "album_id": album_id,
                "album_entity_uid": str(album_entity_uid) if album_entity_uid else None,
                "tracks": int(tracks or 0),
                "export_path": export_path,
                "exported_at": now,
                "updated_at": now,
            },
        )


def get_portable_metadata_status() -> dict[str, int]:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                WITH totals AS (
                    SELECT
                        (SELECT COUNT(*) FROM library_tracks) AS total_tracks,
                        (SELECT COUNT(*) FROM library_albums) AS total_albums
                ),
                lyrics AS (
                    SELECT
                        COUNT(*) FILTER (WHERE cached) AS lyrics_cached,
                        COUNT(*) FILTER (WHERE found) AS lyrics_found
                    FROM (
                        SELECT
                            EXISTS (
                                SELECT 1
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
                            ) AS cached,
                            EXISTS (
                                SELECT 1
                                FROM track_lyrics l
                                WHERE l.provider = 'lrclib'
                                  AND l.found IS TRUE
                                  AND (l.synced_lyrics IS NOT NULL OR l.plain_lyrics IS NOT NULL)
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
                            ) AS found
                        FROM library_tracks lt
                    ) per_track
                ),
                portable AS (
                    SELECT
                        COUNT(*) FILTER (WHERE sidecar_written_at IS NOT NULL) AS portable_sidecar_albums,
                        COUNT(*) FILTER (WHERE audio_tags_written_at IS NOT NULL) AS portable_audio_tag_albums,
                        COALESCE(SUM(tags_written), 0) AS portable_audio_tag_tracks,
                        COALESCE(SUM(tag_errors), 0) AS portable_tag_errors,
                        COUNT(*) FILTER (WHERE exported_at IS NOT NULL) AS rich_export_albums,
                        COALESCE(SUM(tracks) FILTER (WHERE exported_at IS NOT NULL), 0) AS rich_export_tracks
                    FROM album_portable_metadata
                )
                SELECT
                    totals.total_tracks,
                    totals.total_albums,
                    COALESCE(lyrics.lyrics_cached, 0) AS lyrics_cached,
                    COALESCE(lyrics.lyrics_found, 0) AS lyrics_found,
                    GREATEST(totals.total_tracks - COALESCE(lyrics.lyrics_found, 0), 0) AS lyrics_missing,
                    COALESCE(portable.portable_sidecar_albums, 0) AS portable_sidecar_albums,
                    COALESCE(portable.portable_audio_tag_albums, 0) AS portable_audio_tag_albums,
                    COALESCE(portable.portable_audio_tag_tracks, 0) AS portable_audio_tag_tracks,
                    COALESCE(portable.portable_tag_errors, 0) AS portable_tag_errors,
                    COALESCE(portable.rich_export_albums, 0) AS rich_export_albums,
                    COALESCE(portable.rich_export_tracks, 0) AS rich_export_tracks
                FROM totals, lyrics, portable
                """
            )
        ).mappings().first()

    return {key: int(value or 0) for key, value in dict(row or {}).items()}


def _formats(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if item]
    return []


def _track_filename(track: dict[str, Any]) -> str:
    filename = str(track.get("filename") or "").strip()
    if filename:
        return filename
    relative_path = str(track.get("relative_path") or "").strip()
    if relative_path:
        return Path(relative_path).name
    return Path(str(track.get("path") or "")).name


def _restore_track_features(session, track_id: int, track: dict[str, Any]) -> None:
    now = datetime.now(timezone.utc)
    analysis = track.get("analysis") or {}
    if any(analysis.get(key) is not None for key in (
        "bpm",
        "audio_key",
        "audio_scale",
        "energy",
        "mood",
        "danceability",
        "valence",
        "acousticness",
        "instrumentalness",
        "loudness",
        "dynamic_range",
        "spectral_complexity",
    )):
        mood = analysis.get("mood")
        mood_json = json.dumps(mood) if mood is not None and not isinstance(mood, str) else mood
        session.execute(
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
                    CAST(:mood_json AS JSONB),
                    :danceability,
                    :valence,
                    :acousticness,
                    :instrumentalness,
                    :loudness,
                    :dynamic_range,
                    :spectral_complexity,
                    COALESCE(:updated_at, :now)
                )
                ON CONFLICT (track_id) DO UPDATE SET
                    bpm = COALESCE(EXCLUDED.bpm, track_analysis_features.bpm),
                    audio_key = COALESCE(EXCLUDED.audio_key, track_analysis_features.audio_key),
                    audio_scale = COALESCE(EXCLUDED.audio_scale, track_analysis_features.audio_scale),
                    energy = COALESCE(EXCLUDED.energy, track_analysis_features.energy),
                    mood_json = COALESCE(EXCLUDED.mood_json, track_analysis_features.mood_json),
                    danceability = COALESCE(EXCLUDED.danceability, track_analysis_features.danceability),
                    valence = COALESCE(EXCLUDED.valence, track_analysis_features.valence),
                    acousticness = COALESCE(EXCLUDED.acousticness, track_analysis_features.acousticness),
                    instrumentalness = COALESCE(EXCLUDED.instrumentalness, track_analysis_features.instrumentalness),
                    loudness = COALESCE(EXCLUDED.loudness, track_analysis_features.loudness),
                    dynamic_range = COALESCE(EXCLUDED.dynamic_range, track_analysis_features.dynamic_range),
                    spectral_complexity = COALESCE(EXCLUDED.spectral_complexity, track_analysis_features.spectral_complexity),
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {
                "track_id": track_id,
                "bpm": analysis.get("bpm"),
                "audio_key": analysis.get("audio_key"),
                "audio_scale": analysis.get("audio_scale"),
                "energy": analysis.get("energy"),
                "mood_json": mood_json,
                "danceability": analysis.get("danceability"),
                "valence": analysis.get("valence"),
                "acousticness": analysis.get("acousticness"),
                "instrumentalness": analysis.get("instrumentalness"),
                "loudness": analysis.get("loudness"),
                "dynamic_range": analysis.get("dynamic_range"),
                "spectral_complexity": analysis.get("spectral_complexity"),
                "updated_at": analysis.get("updated_at"),
                "now": now,
            },
        )
        session.execute(
            text(
                """
                UPDATE library_tracks
                SET
                    bpm = COALESCE(:bpm, bpm),
                    audio_key = COALESCE(:audio_key, audio_key),
                    audio_scale = COALESCE(:audio_scale, audio_scale),
                    energy = COALESCE(:energy, energy),
                    mood_json = COALESCE(CAST(:mood_json AS JSONB), mood_json),
                    danceability = COALESCE(:danceability, danceability),
                    valence = COALESCE(:valence, valence),
                    acousticness = COALESCE(:acousticness, acousticness),
                    instrumentalness = COALESCE(:instrumentalness, instrumentalness),
                    loudness = COALESCE(:loudness, loudness),
                    dynamic_range = COALESCE(:dynamic_range, dynamic_range),
                    spectral_complexity = COALESCE(:spectral_complexity, spectral_complexity),
                    analysis_state = 'done',
                    analysis_completed_at = COALESCE(:updated_at, :now)
                WHERE id = :track_id
                """
            ),
            {
                "track_id": track_id,
                "bpm": analysis.get("bpm"),
                "audio_key": analysis.get("audio_key"),
                "audio_scale": analysis.get("audio_scale"),
                "energy": analysis.get("energy"),
                "mood_json": mood_json,
                "danceability": analysis.get("danceability"),
                "valence": analysis.get("valence"),
                "acousticness": analysis.get("acousticness"),
                "instrumentalness": analysis.get("instrumentalness"),
                "loudness": analysis.get("loudness"),
                "dynamic_range": analysis.get("dynamic_range"),
                "spectral_complexity": analysis.get("spectral_complexity"),
                "updated_at": analysis.get("updated_at"),
                "now": now,
            },
        )

    bliss = track.get("bliss") or {}
    vector = bliss.get("vector")
    if isinstance(vector, list) and vector:
        session.execute(
            text(
                """
                INSERT INTO track_bliss_embeddings (track_id, bliss_vector, updated_at)
                VALUES (:track_id, CAST(:bliss_vector AS DOUBLE PRECISION[]), COALESCE(:updated_at, :now))
                ON CONFLICT (track_id) DO UPDATE SET
                    bliss_vector = EXCLUDED.bliss_vector,
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {
                "track_id": track_id,
                "bliss_vector": [float(item) for item in vector],
                "updated_at": bliss.get("computed_at"),
                "now": now,
            },
        )
        session.execute(
            text(
                """
                UPDATE library_tracks
                SET
                    bliss_vector = CAST(:bliss_vector AS DOUBLE PRECISION[]),
                    bliss_state = 'done',
                    bliss_computed_at = COALESCE(:updated_at, :now)
                WHERE id = :track_id
                """
            ),
            {
                "track_id": track_id,
                "bliss_vector": [float(item) for item in vector],
                "updated_at": bliss.get("computed_at"),
                "now": now,
            },
        )


def rehydrate_album_payload(payload: dict[str, Any]) -> dict[str, Any]:
    artist = payload.get("artist") or {}
    album = payload.get("album") or {}
    tracks = list(payload.get("tracks") or [])
    if not album.get("path"):
        raise ValueError("portable album payload does not include album.path")

    lyrics_to_store: list[dict[str, Any]] = []
    restored_features = 0
    restored_lyrics = 0
    with transaction_scope() as session:
        artist_name = upsert_artist(
            {
                "name": artist.get("name") or album.get("artist"),
                "storage_id": artist.get("storage_id"),
                "entity_uid": artist.get("entity_uid"),
                "folder_name": artist.get("folder_name") or Path(str(album["path"])).parent.name,
                "album_count": artist.get("album_count") or 1,
                "track_count": artist.get("track_count") or len(tracks),
                "total_size": artist.get("total_size") or sum(int(track.get("size") or 0) for track in tracks),
                "formats": _formats(artist.get("formats_json") or artist.get("formats")),
                "primary_format": artist.get("primary_format"),
                "has_photo": artist.get("has_photo") or 0,
                "mbid": artist.get("mbid"),
                "spotify_id": artist.get("spotify_id"),
            },
            session=session,
        )
        album_id = upsert_album(
            {
                "artist": artist_name,
                "name": album.get("name") or album.get("tag_album") or Path(str(album["path"])).name,
                "storage_id": album.get("storage_id"),
                "entity_uid": album.get("entity_uid"),
                "path": album["path"],
                "track_count": album.get("track_count") or len(tracks),
                "total_size": album.get("total_size") or sum(int(track.get("size") or 0) for track in tracks),
                "total_duration": album.get("total_duration") or sum(float(track.get("duration") or 0) for track in tracks),
                "formats": _formats(album.get("formats_json") or album.get("formats")),
                "year": album.get("year"),
                "genre": album.get("genre"),
                "has_cover": album.get("has_cover") or 0,
                "musicbrainz_albumid": album.get("musicbrainz_albumid"),
                "musicbrainz_releasegroupid": album.get("musicbrainz_releasegroupid"),
                "tag_album": album.get("tag_album"),
            },
            session=session,
        )

        for track in tracks:
            upsert_track(
                {
                    "album_id": album_id,
                    "artist": track.get("artist") or artist_name,
                    "album": track.get("album") or album.get("name") or album.get("tag_album"),
                    "storage_id": track.get("storage_id"),
                    "entity_uid": track.get("entity_uid"),
                    "filename": _track_filename(track),
                    "title": track.get("title"),
                    "track_number": track.get("track_number"),
                    "disc_number": track.get("disc_number") or 1,
                    "format": track.get("format"),
                    "bitrate": track.get("bitrate"),
                    "sample_rate": track.get("sample_rate"),
                    "bit_depth": track.get("bit_depth"),
                    "duration": track.get("duration"),
                    "size": track.get("size"),
                    "year": track.get("year"),
                    "genre": track.get("genre"),
                    "albumartist": track.get("albumartist"),
                    "musicbrainz_albumid": track.get("musicbrainz_albumid") or album.get("musicbrainz_albumid"),
                    "musicbrainz_trackid": track.get("musicbrainz_trackid"),
                    "audio_fingerprint": track.get("audio_fingerprint"),
                    "audio_fingerprint_source": track.get("audio_fingerprint_source"),
                    "path": track["path"],
                },
                session=session,
            )
            track_row = session.execute(
                text("SELECT id, entity_uid FROM library_tracks WHERE path = :path LIMIT 1"),
                {"path": track["path"]},
            ).mappings().first()
            if not track_row:
                continue
            _restore_track_features(session, int(track_row["id"]), track)
            if (track.get("analysis") or {}).get("updated_at") or (track.get("bliss") or {}).get("computed_at"):
                restored_features += 1

            lyrics = track.get("lyrics") or {}
            if lyrics:
                lyrics_to_store.append(
                    {
                        "artist": track.get("artist") or artist_name,
                        "title": track.get("title") or Path(_track_filename(track)).stem,
                        "track_id": int(track_row["id"]),
                        "track_entity_uid": str(track_row["entity_uid"]) if track_row["entity_uid"] else None,
                        "synced_lyrics": lyrics.get("synced"),
                        "plain_lyrics": lyrics.get("plain"),
                        "found": bool(lyrics.get("found")),
                    }
                )

    for item in lyrics_to_store:
        store_lyrics(
            item["artist"],
            item["title"],
            synced_lyrics=item.get("synced_lyrics"),
            plain_lyrics=item.get("plain_lyrics"),
            track_id=item.get("track_id"),
            track_entity_uid=item.get("track_entity_uid"),
            source_json={"source": "portable_metadata"},
            found=bool(item.get("found")),
        )
        restored_lyrics += 1

    mark_album_portable_metadata(
        album_id=album_id,
        album_entity_uid=album.get("entity_uid"),
        sidecar_path=payload.get("_sidecar_path"),
        tracks=len(tracks),
        tags_written=0,
        tag_errors=0,
        wrote_sidecar=bool(payload.get("_sidecar_path")),
        wrote_audio_tags=False,
    )
    return {
        "album_id": album_id,
        "artist": artist.get("name") or album.get("artist"),
        "album": album.get("name") or album.get("tag_album"),
        "tracks": len(tracks),
        "features": restored_features,
        "lyrics": restored_lyrics,
    }


__all__ = [
    "get_portable_metadata_status",
    "mark_album_portable_metadata",
    "mark_album_rich_export",
    "rehydrate_album_payload",
]
