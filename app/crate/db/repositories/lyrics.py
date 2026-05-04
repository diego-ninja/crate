from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope


_SPACE_RE = re.compile(r"\s+")


def lyrics_key(value: str) -> str:
    return _SPACE_RE.sub(" ", str(value or "").strip().lower())


def _coerce_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def _payload_from_row(row: Any) -> dict[str, Any]:
    updated_at = _coerce_datetime(row.get("updated_at"))
    return {
        "syncedLyrics": row.get("synced_lyrics"),
        "plainLyrics": row.get("plain_lyrics"),
        "found": bool(row.get("found")),
        "provider": row.get("provider") or "lrclib",
        "updated_at": updated_at.isoformat() if updated_at else None,
    }


def get_cached_lyrics(
    artist: str,
    title: str,
    *,
    provider: str = "lrclib",
    max_age_seconds: int | None = 86400 * 30,
) -> dict[str, Any] | None:
    artist_key = lyrics_key(artist)
    title_key = lyrics_key(title)
    if not artist_key or not title_key:
        return None

    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT provider, synced_lyrics, plain_lyrics, found, updated_at
                FROM track_lyrics
                WHERE provider = :provider
                  AND artist_key = :artist_key
                  AND title_key = :title_key
                LIMIT 1
                """
            ),
            {"provider": provider, "artist_key": artist_key, "title_key": title_key},
        ).mappings().first()

    if not row:
        return None

    if max_age_seconds is not None:
        updated_at = _coerce_datetime(row.get("updated_at"))
        if updated_at is None:
            return None
        age = (datetime.now(timezone.utc) - updated_at).total_seconds()
        if age > max_age_seconds:
            return None

    return _payload_from_row(row)


def store_lyrics(
    artist: str,
    title: str,
    *,
    synced_lyrics: str | None = None,
    plain_lyrics: str | None = None,
    provider: str = "lrclib",
    track_id: int | None = None,
    track_entity_uid: str | None = None,
    source_json: dict[str, Any] | None = None,
    found: bool | None = None,
) -> dict[str, Any]:
    artist_clean = str(artist or "").strip()
    title_clean = str(title or "").strip()
    artist_key = lyrics_key(artist_clean)
    title_key = lyrics_key(title_clean)
    if not artist_key or not title_key:
        raise ValueError("artist and title are required")

    has_lyrics = bool(synced_lyrics or plain_lyrics)
    found_value = has_lyrics if found is None else bool(found)
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                INSERT INTO track_lyrics (
                    provider,
                    artist_key,
                    title_key,
                    artist,
                    title,
                    track_id,
                    track_entity_uid,
                    synced_lyrics,
                    plain_lyrics,
                    found,
                    source_json,
                    updated_at
                )
                VALUES (
                    :provider,
                    :artist_key,
                    :title_key,
                    :artist,
                    :title,
                    :track_id,
                    CAST(:track_entity_uid AS uuid),
                    :synced_lyrics,
                    :plain_lyrics,
                    :found,
                    CAST(:source_json AS jsonb),
                    NOW()
                )
                ON CONFLICT (provider, artist_key, title_key) DO UPDATE SET
                    artist = EXCLUDED.artist,
                    title = EXCLUDED.title,
                    track_id = COALESCE(EXCLUDED.track_id, track_lyrics.track_id),
                    track_entity_uid = COALESCE(EXCLUDED.track_entity_uid, track_lyrics.track_entity_uid),
                    synced_lyrics = EXCLUDED.synced_lyrics,
                    plain_lyrics = EXCLUDED.plain_lyrics,
                    found = EXCLUDED.found,
                    source_json = EXCLUDED.source_json,
                    updated_at = EXCLUDED.updated_at
                RETURNING provider, synced_lyrics, plain_lyrics, found, updated_at
                """
            ),
            {
                "provider": provider,
                "artist_key": artist_key,
                "title_key": title_key,
                "artist": artist_clean,
                "title": title_clean,
                "track_id": track_id,
                "track_entity_uid": track_entity_uid,
                "synced_lyrics": synced_lyrics,
                "plain_lyrics": plain_lyrics,
                "found": found_value,
                "source_json": json.dumps(source_json or {}, default=str),
            },
        ).mappings().one()

    return _payload_from_row(row)


__all__ = ["get_cached_lyrics", "lyrics_key", "store_lyrics"]
