from __future__ import annotations

from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope


def _row_dict(row: Any) -> dict[str, Any]:
    return dict(row) if row else {}


def list_portable_album_ids(
    *,
    album_id: int | None = None,
    album_entity_uid: str | None = None,
    artist: str | None = None,
    limit: int | None = None,
) -> list[int]:
    safe_limit = min(max(int(limit), 1), 10000) if limit is not None else None
    params: dict[str, Any] = {"album_id": album_id, "album_entity_uid": album_entity_uid, "artist": artist}
    limit_sql = "LIMIT :limit" if safe_limit is not None else ""
    if safe_limit is not None:
        params["limit"] = safe_limit

    with read_scope() as session:
        rows = session.execute(
            text(
                f"""
                SELECT id
                FROM library_albums
                WHERE (:album_id IS NULL OR id = :album_id)
                  AND (:album_entity_uid IS NULL OR entity_uid::text = :album_entity_uid)
                  AND (:artist IS NULL OR lower(artist) = lower(:artist))
                ORDER BY artist, COALESCE(year, ''), name, id
                {limit_sql}
                """
            ),
            params,
        ).mappings().all()
    return [int(row["id"]) for row in rows]


def get_portable_album_payload(album_id: int) -> dict[str, Any] | None:
    with read_scope() as session:
        album_row = session.execute(
            text(
                """
                SELECT
                    alb.id,
                    alb.storage_id,
                    alb.entity_uid,
                    alb.artist,
                    alb.name,
                    alb.path,
                    alb.track_count,
                    alb.total_size,
                    alb.total_duration,
                    alb.formats_json,
                    alb.year,
                    alb.genre,
                    alb.has_cover,
                    alb.musicbrainz_albumid,
                    alb.musicbrainz_releasegroupid,
                    alb.discogs_master_id,
                    alb.lastfm_listeners,
                    alb.lastfm_playcount,
                    alb.popularity,
                    alb.slug,
                    alb.updated_at
                FROM library_albums alb
                WHERE alb.id = :album_id
                LIMIT 1
                """
            ),
            {"album_id": album_id},
        ).mappings().first()
        if not album_row:
            return None

        artist_row = session.execute(
            text(
                """
                SELECT
                    id,
                    storage_id,
                    entity_uid,
                    name,
                    slug,
                    folder_name,
                    mbid,
                    country,
                    area,
                    formed,
                    ended,
                    artist_type,
                    tags_json,
                    similar_json,
                    listeners,
                    spotify_id,
                    spotify_popularity,
                    spotify_followers,
                    lastfm_playcount,
                    discogs_id,
                    latest_release_date,
                    enriched_at,
                    updated_at
                FROM library_artists
                WHERE name = :artist
                LIMIT 1
                """
            ),
            {"artist": album_row["artist"]},
        ).mappings().first()

        track_rows = session.execute(
            text(
                """
                SELECT
                    lt.id,
                    lt.storage_id,
                    lt.entity_uid,
                    lt.album_id,
                    lt.artist,
                    lt.album,
                    lt.filename,
                    lt.title,
                    lt.track_number,
                    lt.disc_number,
                    lt.format,
                    lt.bitrate,
                    lt.sample_rate,
                    lt.bit_depth,
                    lt.duration,
                    lt.size,
                    lt.year,
                    lt.genre,
                    lt.albumartist,
                    lt.musicbrainz_albumid,
                    lt.musicbrainz_trackid,
                    lt.audio_fingerprint,
                    lt.audio_fingerprint_source,
                    lt.audio_fingerprint_computed_at,
                    lt.path,
                    lt.updated_at,
                    COALESCE(taf.bpm, lt.bpm) AS analysis_bpm,
                    COALESCE(taf.audio_key, lt.audio_key) AS analysis_audio_key,
                    COALESCE(taf.audio_scale, lt.audio_scale) AS analysis_audio_scale,
                    COALESCE(taf.energy, lt.energy) AS analysis_energy,
                    COALESCE(taf.mood_json, lt.mood_json) AS analysis_mood_json,
                    COALESCE(taf.danceability, lt.danceability) AS analysis_danceability,
                    COALESCE(taf.valence, lt.valence) AS analysis_valence,
                    COALESCE(taf.acousticness, lt.acousticness) AS analysis_acousticness,
                    COALESCE(taf.instrumentalness, lt.instrumentalness) AS analysis_instrumentalness,
                    COALESCE(taf.loudness, lt.loudness) AS analysis_loudness,
                    COALESCE(taf.dynamic_range, lt.dynamic_range) AS analysis_dynamic_range,
                    COALESCE(taf.spectral_complexity, lt.spectral_complexity) AS analysis_spectral_complexity,
                    COALESCE(taf.updated_at, lt.analysis_completed_at) AS analysis_updated_at,
                    COALESCE(tbe.bliss_vector, lt.bliss_vector) AS bliss_vector,
                    COALESCE(tbe.updated_at, lt.bliss_computed_at) AS bliss_computed_at,
                    lyr.provider AS lyrics_provider,
                    lyr.found AS lyrics_found,
                    lyr.synced_lyrics,
                    lyr.plain_lyrics,
                    lyr.updated_at AS lyrics_updated_at
                FROM library_tracks lt
                LEFT JOIN track_analysis_features taf ON taf.track_id = lt.id
                LEFT JOIN track_bliss_embeddings tbe ON tbe.track_id = lt.id
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
                ORDER BY COALESCE(lt.disc_number, 1), COALESCE(lt.track_number, 9999), lt.filename, lt.id
                """
            ),
            {"album_id": album_id},
        ).mappings().all()

    album = _row_dict(album_row)
    artist_payload = _row_dict(artist_row)
    tracks = []
    album_path = str(album.get("path") or "")
    album_prefix = album_path.rstrip("/") + "/" if album_path else ""
    for row in track_rows:
        track = _row_dict(row)
        path = str(track.get("path") or "")
        lyrics = None
        if track.get("lyrics_provider") is not None:
            lyrics = {
                "provider": track.get("lyrics_provider"),
                "found": bool(track.get("lyrics_found")),
                "synced": track.get("synced_lyrics"),
                "plain": track.get("plain_lyrics"),
                "updated_at": track.get("lyrics_updated_at"),
            }
        tracks.append(
            {
                "id": track.get("id"),
                "storage_id": track.get("storage_id"),
                "entity_uid": track.get("entity_uid"),
                "path": path,
                "relative_path": (
                    path[len(album_prefix):]
                    if album_prefix and path.startswith(album_prefix)
                    else track.get("filename")
                ),
                "filename": track.get("filename"),
                "title": track.get("title"),
                "artist": track.get("artist"),
                "album": track.get("album"),
                "album_id": track.get("album_id"),
                "track_number": track.get("track_number"),
                "disc_number": track.get("disc_number"),
                "format": track.get("format"),
                "bitrate": track.get("bitrate"),
                "sample_rate": track.get("sample_rate"),
                "bit_depth": track.get("bit_depth"),
                "duration": track.get("duration"),
                "size": track.get("size"),
                "year": track.get("year"),
                "genre": track.get("genre"),
                "albumartist": track.get("albumartist"),
                "musicbrainz_albumid": track.get("musicbrainz_albumid"),
                "musicbrainz_trackid": track.get("musicbrainz_trackid"),
                "audio_fingerprint": track.get("audio_fingerprint"),
                "audio_fingerprint_source": track.get("audio_fingerprint_source"),
                "audio_fingerprint_computed_at": track.get("audio_fingerprint_computed_at"),
                "updated_at": track.get("updated_at"),
                "analysis": {
                    "bpm": track.get("analysis_bpm"),
                    "audio_key": track.get("analysis_audio_key"),
                    "audio_scale": track.get("analysis_audio_scale"),
                    "energy": track.get("analysis_energy"),
                    "mood": track.get("analysis_mood_json"),
                    "danceability": track.get("analysis_danceability"),
                    "valence": track.get("analysis_valence"),
                    "acousticness": track.get("analysis_acousticness"),
                    "instrumentalness": track.get("analysis_instrumentalness"),
                    "loudness": track.get("analysis_loudness"),
                    "dynamic_range": track.get("analysis_dynamic_range"),
                    "spectral_complexity": track.get("analysis_spectral_complexity"),
                    "updated_at": track.get("analysis_updated_at"),
                },
                "bliss": {
                    "vector": list(track["bliss_vector"]) if track.get("bliss_vector") is not None else None,
                    "computed_at": track.get("bliss_computed_at"),
                },
                "lyrics": lyrics,
            }
        )

    return {
        "schema_version": 1,
        "artist": artist_payload,
        "album": album,
        "tracks": tracks,
    }


def get_portable_track_payload_by_path(track_path: str) -> dict[str, Any] | None:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT album_id
                FROM library_tracks
                WHERE path = :track_path
                LIMIT 1
                """
            ),
            {"track_path": str(track_path)},
        ).mappings().first()
    if not row:
        return None

    album_payload = get_portable_album_payload(int(row["album_id"]))
    if not album_payload:
        return None

    normalized_path = str(track_path)
    for track in album_payload.get("tracks") or []:
        if str(track.get("path") or "") == normalized_path:
            return {
                "artist": album_payload.get("artist") or {},
                "album": album_payload.get("album") or {},
                "track": track,
            }
    return None


__all__ = ["get_portable_album_payload", "get_portable_track_payload_by_path", "list_portable_album_ids"]
