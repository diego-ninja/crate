from __future__ import annotations


def _track_payload(row: dict) -> dict:
    track_entity_uid = str(row["track_entity_uid"]) if row.get("track_entity_uid") is not None else None
    artist_entity_uid = str(row["artist_entity_uid"]) if row.get("artist_entity_uid") is not None else None
    album_entity_uid = str(row["album_entity_uid"]) if row.get("album_entity_uid") is not None else None
    bliss_vector = row.get("bliss_vector")
    return {
        "track_id": row.get("track_id"),
        "track_entity_uid": track_entity_uid,
        "track_path": row.get("track_path"),
        "title": row.get("title") or "",
        "artist": row.get("artist") or "",
        "artist_id": row.get("artist_id"),
        "artist_entity_uid": artist_entity_uid,
        "artist_slug": row.get("artist_slug"),
        "album": row.get("album") or "",
        "album_id": row.get("album_id"),
        "album_entity_uid": album_entity_uid,
        "album_slug": row.get("album_slug"),
        "duration": row.get("duration"),
        "format": row.get("format"),
        "bitrate": (row["bitrate"] // 1000) if row.get("bitrate") else None,
        "sample_rate": row.get("sample_rate"),
        "bit_depth": row.get("bit_depth"),
        "bpm": row.get("bpm"),
        "audio_key": row.get("audio_key"),
        "audio_scale": row.get("audio_scale"),
        "energy": row.get("energy"),
        "danceability": row.get("danceability"),
        "valence": row.get("valence"),
        "bliss_vector": list(bliss_vector) if bliss_vector is not None else None,
    }


def _artwork_tracks(rows: list[dict], limit: int = 4) -> list[dict]:
    artwork: list[dict] = []
    seen: set[tuple[object, str, str]] = set()
    for row in rows:
        key = (row.get("album_id"), row.get("artist") or "", row.get("album") or "")
        if key in seen:
            continue
        seen.add(key)
        artwork.append(
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
        if len(artwork) >= limit:
            break
    return artwork


def _artwork_artists(rows: list[dict], limit: int = 4) -> list[dict]:
    artwork: list[dict] = []
    seen: set[object] = set()
    for row in rows:
        artist_key = row.get("artist_id") or (row.get("artist") or "").strip().lower()
        if not artist_key or artist_key in seen:
            continue
        seen.add(artist_key)
        artwork.append(
            {
                "artist_name": row.get("artist") or "",
                "artist_id": row.get("artist_id"),
                "artist_entity_uid": (
                    str(row["artist_entity_uid"]) if row.get("artist_entity_uid") is not None else None
                ),
                "artist_slug": row.get("artist_slug"),
            }
        )
        if len(artwork) >= limit:
            break
    return artwork


__all__ = [
    "_artwork_artists",
    "_artwork_tracks",
    "_track_payload",
]
