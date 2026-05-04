from __future__ import annotations

import json
import re
import unicodedata
import uuid

from sqlalchemy import text


_NON_ALNUM_RE = re.compile(r"[^0-9a-z]+")


def _normalize_text(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKD", (value or "").strip())
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii").casefold()
    return _NON_ALNUM_RE.sub(" ", ascii_value).strip()


def normalize_identity_key_value(key_type: str, key_value: str | None) -> str:
    raw = (key_value or "").strip()
    if not raw:
        return ""
    key_type = (key_type or "").strip().lower()
    if key_type in {
        "mbid",
        "musicbrainz_albumid",
        "musicbrainz_releasegroupid",
        "musicbrainz_trackid",
        "spotify_id",
        "spotify_album_id",
        "spotify_track_id",
        "spotify_artist_id",
    }:
        return _normalize_text(raw).replace(" ", "")
    if key_type.endswith("_slug") or key_type == "slug":
        return _normalize_text(raw).replace(" ", "-")
    return _normalize_text(raw)


def upsert_entity_identity_key(
    session,
    *,
    entity_type: str,
    entity_uid: str | uuid.UUID | None,
    key_type: str,
    key_value: str | None,
    is_primary: bool = False,
    metadata: dict | None = None,
) -> None:
    if not entity_uid:
        return
    normalized_key = normalize_identity_key_value(key_type, key_value)
    if not normalized_key:
        return

    session.execute(
        text(
            """
            INSERT INTO entity_identity_keys (entity_type, entity_uid, key_type, key_value, is_primary, metadata_json)
            VALUES (:entity_type, :entity_uid, :key_type, :key_value, :is_primary, CAST(:metadata_json AS jsonb))
            ON CONFLICT (entity_type, key_type, key_value) DO UPDATE
            SET entity_uid = EXCLUDED.entity_uid,
                is_primary = entity_identity_keys.is_primary OR EXCLUDED.is_primary,
                metadata_json = COALESCE(entity_identity_keys.metadata_json, EXCLUDED.metadata_json)
            """
        ),
        {
            "entity_type": entity_type,
            "entity_uid": str(entity_uid),
            "key_type": key_type,
            "key_value": normalized_key,
            "is_primary": bool(is_primary),
            "metadata_json": json.dumps(metadata or {}) if metadata is not None else None,
        },
    )


__all__ = [
    "normalize_identity_key_value",
    "upsert_entity_identity_key",
]
