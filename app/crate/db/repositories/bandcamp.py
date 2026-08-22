from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping, cast
from urllib.parse import urlparse, urlunparse

from sqlalchemy import text

from crate.bandcamp.client import is_bandcamp_host
from crate.db.serialize import serialize_row
from crate.db.tx import optional_scope


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _rowcount(result: Any) -> int:
    return int(getattr(cast(Any, result), "rowcount", 0) or 0)


def _clean_bandcamp_url(url: Any, *, keep_path: bool) -> str | None:
    raw = str(url or "").strip()
    if not raw:
        return None
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not is_bandcamp_host(parsed.hostname):
        return None
    host = (parsed.hostname or "").lower()
    path = parsed.path.rstrip("/") if keep_path else ""
    return urlunparse(("https", host, path, "", "", ""))


def _bandcamp_artist_url_from_item(item: Mapping[Any, Any]) -> str | None:
    artist_url = _clean_bandcamp_url(item.get("artist_url"), keep_path=False)
    if artist_url:
        return artist_url

    item_url = str(item.get("item_url") or "")
    parsed = urlparse(item_url)
    host = (parsed.hostname or "").lower()
    if host.endswith(".bandcamp.com") and host not in {
        "bandcamp.com",
        "www.bandcamp.com",
    }:
        return _clean_bandcamp_url(item_url, keep_path=False)
    return None


def _bandcamp_album_url_from_item(item: Mapping[Any, Any]) -> str | None:
    return _clean_bandcamp_url(
        item.get("album_url"), keep_path=True
    ) or _clean_bandcamp_url(item.get("item_url"), keep_path=True)


def get_exact_bandcamp_library_candidates(
    bandcamp_item_id: int, *, session=None
) -> dict[str, dict[str, Any] | None] | None:
    with optional_scope(session) as current:
        item = (
            current.execute(
                text("""
                SELECT *
                FROM bandcamp_items
                WHERE id = :bandcamp_item_id
                """),
                {"bandcamp_item_id": bandcamp_item_id},
            )
            .mappings()
            .first()
        )
        if not item:
            return None

        artist_name = str(item.get("artist_name") or "").strip()
        album_title = str(item.get("album_title") or "").strip()
        artist = None
        album = None
        if artist_name:
            artist = (
                current.execute(
                    text("""
                    SELECT entity_uid::text AS entity_uid, name
                    FROM library_artists
                    WHERE entity_uid IS NOT NULL
                      AND lower(name) = lower(:artist_name)
                    LIMIT 1
                    """),
                    {"artist_name": artist_name},
                )
                .mappings()
                .first()
            )
        if artist_name and album_title:
            album = (
                current.execute(
                    text("""
                    SELECT entity_uid::text AS entity_uid, artist, name
                    FROM library_albums
                    WHERE entity_uid IS NOT NULL
                      AND lower(artist) = lower(:artist_name)
                      AND lower(name) = lower(:album_title)
                    LIMIT 1
                    """),
                    {"artist_name": artist_name, "album_title": album_title},
                )
                .mappings()
                .first()
            )

    return {
        "item": dict(item),
        "artist": dict(artist) if artist else None,
        "album": dict(album) if album else None,
    }


def _sync_confirmed_bandcamp_entity_url(
    session,
    match: Mapping[Any, Any],
) -> bool:
    if match.get("status") != "confirmed":
        return False
    entity_type = str(match.get("entity_type") or "")
    if entity_type not in {"artist", "album"}:
        return False

    row = (
        session.execute(
            text("""
            SELECT
                blm.entity_type,
                blm.entity_uid::text AS entity_uid,
                blm.source,
                bi.item_url,
                bi.artist_url,
                bi.album_url
            FROM bandcamp_library_matches blm
            JOIN bandcamp_items bi ON bi.id = blm.bandcamp_item_id
            WHERE blm.id = :match_id
              AND blm.status = 'confirmed'
            """),
            {"match_id": match.get("id")},
        )
        .mappings()
        .first()
    )
    if not row:
        return False

    url = (
        _bandcamp_artist_url_from_item(row)
        if entity_type == "artist"
        else _bandcamp_album_url_from_item(row)
    )
    if not url:
        return False

    now = _now()
    source = f"bandcamp:{row['source'] or 'match'}"
    if entity_type == "artist":
        result = session.execute(
            text("""
            UPDATE library_artists
            SET bandcamp_url = :url,
                bandcamp_url_source = :source,
                bandcamp_url_updated_at = :updated_at
            WHERE entity_uid = CAST(:entity_uid AS uuid)
            """),
            {
                "entity_uid": row["entity_uid"],
                "url": url,
                "source": source,
                "updated_at": now,
            },
        )
        return bool(_rowcount(result))

    result = session.execute(
        text("""
        UPDATE library_albums
        SET bandcamp_url = :url,
            bandcamp_url_source = :source,
            bandcamp_url_updated_at = :updated_at
        WHERE entity_uid = CAST(:entity_uid AS uuid)
        """),
        {
            "entity_uid": row["entity_uid"],
            "url": url,
            "source": source,
            "updated_at": now,
        },
    )
    return bool(_rowcount(result))


def _persisted_bandcamp_link_for_entity(
    session,
    *,
    entity_type: str,
    entity_uid: str,
) -> dict | None:
    if entity_type == "artist":
        row = (
            session.execute(
                text("""
                SELECT
                    entity_uid::text AS entity_uid,
                    bandcamp_url,
                    bandcamp_url_source,
                    bandcamp_url_updated_at
                FROM library_artists
                WHERE entity_uid = CAST(:entity_uid AS uuid)
                  AND NULLIF(trim(coalesce(bandcamp_url, '')), '') IS NOT NULL
                LIMIT 1
                """),
                {"entity_uid": entity_uid},
            )
            .mappings()
            .first()
        )
        if not row:
            return None
        url = _clean_bandcamp_url(row["bandcamp_url"], keep_path=False)
        if not url:
            return None
        return {
            "entity_type": "artist",
            "entity_uid": row["entity_uid"],
            "artist_url": url,
            "match_status": None,
            "match_source": row.get("bandcamp_url_source"),
            "link_source": "entity_url",
            "bandcamp_url_updated_at": row.get("bandcamp_url_updated_at"),
        }

    if entity_type == "album":
        row = (
            session.execute(
                text("""
                SELECT
                    entity_uid::text AS entity_uid,
                    bandcamp_url,
                    bandcamp_url_source,
                    bandcamp_url_updated_at
                FROM library_albums
                WHERE entity_uid = CAST(:entity_uid AS uuid)
                  AND NULLIF(trim(coalesce(bandcamp_url, '')), '') IS NOT NULL
                LIMIT 1
                """),
                {"entity_uid": entity_uid},
            )
            .mappings()
            .first()
        )
        if not row:
            return None
        url = _clean_bandcamp_url(row["bandcamp_url"], keep_path=True)
        if not url:
            return None
        return {
            "entity_type": "album",
            "entity_uid": row["entity_uid"],
            "album_url": url,
            "match_status": None,
            "match_source": row.get("bandcamp_url_source"),
            "link_source": "entity_url",
            "bandcamp_url_updated_at": row.get("bandcamp_url_updated_at"),
        }

    return None


def get_connection_for_user(user_id: int, *, session=None) -> dict | None:
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                SELECT *
                FROM bandcamp_connections
                WHERE user_id = :user_id
                  AND revoked_at IS NULL
                ORDER BY updated_at DESC
                LIMIT 1
                """),
                {"user_id": user_id},
            )
            .mappings()
            .first()
        )
    return serialize_row(row) if row else None


def has_active_connection(user_id: int, *, session=None) -> bool:
    with optional_scope(session) as s:
        return (
            s.execute(
                text("""
                SELECT 1
                FROM bandcamp_connections
                WHERE user_id = :user_id
                  AND status = 'connected'
                  AND revoked_at IS NULL
                LIMIT 1
                """),
                {"user_id": user_id},
            ).first()
            is not None
        )


def get_connection_by_id(connection_id: int, *, session=None) -> dict | None:
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                SELECT *
                FROM bandcamp_connections
                WHERE id = :connection_id
                  AND revoked_at IS NULL
                """),
                {"connection_id": connection_id},
            )
            .mappings()
            .first()
        )
    return serialize_row(row) if row else None


def upsert_connection(
    *,
    user_id: int,
    session_secret_ref: str,
    session_fingerprint: str,
    connection_method: str,
    username: str = "",
    fan_id: int | None = None,
    display_name: str = "",
    image_url: str = "",
    password_secret_ref: str | None = None,
    settings: dict[str, Any] | None = None,
    session=None,
) -> dict:
    now = _now()
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                INSERT INTO bandcamp_connections (
                    user_id, username, fan_id, display_name, image_url, status,
                    session_secret_ref, session_fingerprint, password_secret_ref,
                    connection_method, last_success_at, sync_cursor_json,
                    settings_json, created_at, updated_at, revoked_at, last_error
                )
                VALUES (
                    :user_id, NULLIF(:username, ''), :fan_id, NULLIF(:display_name, ''),
                    NULLIF(:image_url, ''), 'connected', :session_secret_ref,
                    :session_fingerprint, :password_secret_ref, :connection_method,
                    :now, '{}'::jsonb, CAST(:settings_json AS jsonb), :now, :now,
                    NULL, NULL
                )
                ON CONFLICT (user_id) DO UPDATE SET
                    username = EXCLUDED.username,
                    fan_id = EXCLUDED.fan_id,
                    display_name = EXCLUDED.display_name,
                    image_url = EXCLUDED.image_url,
                    status = 'connected',
                    session_secret_ref = EXCLUDED.session_secret_ref,
                    session_fingerprint = EXCLUDED.session_fingerprint,
                    password_secret_ref = EXCLUDED.password_secret_ref,
                    connection_method = EXCLUDED.connection_method,
                    last_success_at = EXCLUDED.last_success_at,
                    settings_json = EXCLUDED.settings_json,
                    updated_at = EXCLUDED.updated_at,
                    revoked_at = NULL,
                    last_error = NULL
                RETURNING *
                """),
                {
                    "user_id": user_id,
                    "username": username,
                    "fan_id": fan_id,
                    "display_name": display_name,
                    "image_url": image_url,
                    "session_secret_ref": session_secret_ref,
                    "session_fingerprint": session_fingerprint,
                    "password_secret_ref": password_secret_ref,
                    "connection_method": connection_method,
                    "settings_json": json.dumps(settings or {}),
                    "now": now,
                },
            )
            .mappings()
            .one()
        )
    return serialize_row(row)


def mark_connection_error(user_id: int, error: str, *, session=None) -> None:
    now = _now()
    with optional_scope(session) as s:
        s.execute(
            text("""
            UPDATE bandcamp_connections
            SET status = 'error', last_error = :error, updated_at = :now
            WHERE user_id = :user_id AND revoked_at IS NULL
            """),
            {"user_id": user_id, "error": error[:1000], "now": now},
        )


def mark_connection_synced(connection_id: int, *, session=None) -> None:
    now = _now()
    with optional_scope(session) as s:
        s.execute(
            text("""
            UPDATE bandcamp_connections
            SET status = 'connected',
                last_sync_at = :now,
                last_success_at = :now,
                last_error = NULL,
                updated_at = :now
            WHERE id = :connection_id
            """),
            {"connection_id": connection_id, "now": now},
        )


def disconnect_connection(user_id: int, *, session=None) -> dict | None:
    now = _now()
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                UPDATE bandcamp_connections
                SET status = 'revoked', revoked_at = :now, updated_at = :now
                WHERE user_id = :user_id AND revoked_at IS NULL
                RETURNING *
                """),
                {"user_id": user_id, "now": now},
            )
            .mappings()
            .first()
        )
    return serialize_row(row) if row else None


def create_pairing_challenge(
    *,
    user_id: int,
    connection_method: str,
    ttl_seconds: int = 600,
    session=None,
) -> dict:
    now = _now()
    expires_at = now + timedelta(seconds=ttl_seconds)
    pairing_id = secrets.token_urlsafe(24)
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                INSERT INTO bandcamp_pairing_challenges (
                    pairing_id, user_id, status, connection_method, result_json,
                    created_at, expires_at
                )
                VALUES (
                    :pairing_id, :user_id, 'pending', :connection_method,
                    '{}'::jsonb, :created_at, :expires_at
                )
                RETURNING *
                """),
                {
                    "pairing_id": pairing_id,
                    "user_id": user_id,
                    "connection_method": connection_method,
                    "created_at": now,
                    "expires_at": expires_at,
                },
            )
            .mappings()
            .one()
        )
    return serialize_row(row)


def get_pairing_challenge(
    pairing_id: str, *, user_id: int | None = None
) -> dict | None:
    query = """
        SELECT *
        FROM bandcamp_pairing_challenges
        WHERE pairing_id = :pairing_id
    """
    params: dict[str, Any] = {"pairing_id": pairing_id}
    if user_id is not None:
        query += " AND user_id = :user_id"
        params["user_id"] = user_id
    with optional_scope(None) as s:
        row = s.execute(text(query), params).mappings().first()
    return serialize_row(row) if row else None


def mark_pairing_task(pairing_id: str, task_id: str, *, session=None) -> None:
    with optional_scope(session) as s:
        s.execute(
            text("""
            UPDATE bandcamp_pairing_challenges
            SET status = 'running', task_id = :task_id
            WHERE pairing_id = :pairing_id
            """),
            {"pairing_id": pairing_id, "task_id": task_id},
        )


def complete_pairing_challenge(
    pairing_id: str,
    *,
    status: str,
    result: dict[str, Any] | None = None,
    session=None,
) -> None:
    now = _now()
    with optional_scope(session) as s:
        s.execute(
            text("""
            UPDATE bandcamp_pairing_challenges
            SET status = :status,
                result_json = CAST(:result_json AS jsonb),
                completed_at = :now
            WHERE pairing_id = :pairing_id
            """),
            {
                "pairing_id": pairing_id,
                "status": status,
                "result_json": json.dumps(result or {}),
                "now": now,
            },
        )


def list_user_collection(
    user_id: int, relation_type: str, *, limit: int = 100, session=None
) -> list[dict]:
    if not has_active_connection(user_id, session=session):
        return []

    with optional_scope(session) as s:
        rows = (
            s.execute(
                text("""
                SELECT
                    ubi.*,
                    bi.bandcamp_item_type,
                    bi.artist_name,
                    bi.album_title,
                    bi.track_title,
                    bi.item_url,
                    bi.cover_url,
                    bi.release_date,
                    bi.tags_json,
                    latest_import.status AS latest_import_status,
                    latest_import.id AS latest_import_id
                FROM user_bandcamp_items ubi
                JOIN bandcamp_items bi ON bi.id = ubi.bandcamp_item_id
                LEFT JOIN LATERAL (
                    SELECT id, status
                    FROM bandcamp_imports bci
                    WHERE bci.user_id = ubi.user_id
                      AND bci.bandcamp_item_id = ubi.bandcamp_item_id
                    ORDER BY bci.created_at DESC
                    LIMIT 1
                ) latest_import ON TRUE
                WHERE ubi.user_id = :user_id
                  AND ubi.relation_type = :relation_type
                  AND ubi.removed_at IS NULL
                ORDER BY COALESCE(ubi.added_at, ubi.purchase_date, ubi.last_seen_at) DESC
                LIMIT :limit
                """),
                {
                    "user_id": user_id,
                    "relation_type": relation_type,
                    "limit": limit,
                },
            )
            .mappings()
            .all()
        )
    return [serialize_row(row) for row in rows]


def list_admin_user_collections(
    relation_type: str = "",
    *,
    limit: int = 200,
    session=None,
) -> list[dict]:
    with optional_scope(session) as s:
        rows = (
            s.execute(
                text("""
                SELECT
                    ubi.*,
                    bi.bandcamp_item_type,
                    bi.artist_name,
                    bi.album_title,
                    bi.track_title,
                    bi.item_url,
                    bi.cover_url,
                    bi.release_date,
                    bi.tags_json,
                    u.email AS user_email,
                    u.username AS user_username,
                    u.name AS user_name,
                    latest_import.status AS latest_import_status,
                    latest_import.id AS latest_import_id
                FROM user_bandcamp_items ubi
                JOIN bandcamp_items bi ON bi.id = ubi.bandcamp_item_id
                JOIN users u ON u.id = ubi.user_id
                LEFT JOIN LATERAL (
                    SELECT id, status
                    FROM bandcamp_imports bci
                    WHERE bci.user_id = ubi.user_id
                      AND bci.bandcamp_item_id = ubi.bandcamp_item_id
                    ORDER BY bci.created_at DESC
                    LIMIT 1
                ) latest_import ON TRUE
                WHERE ubi.removed_at IS NULL
                  AND (:relation_type = '' OR ubi.relation_type = :relation_type)
                ORDER BY COALESCE(ubi.added_at, ubi.purchase_date, ubi.last_seen_at) DESC
                LIMIT :limit
                """),
                {
                    "relation_type": relation_type,
                    "limit": limit,
                },
            )
            .mappings()
            .all()
        )
    return [serialize_row(row) for row in rows]


def upsert_bandcamp_item(item: dict[str, Any], *, session=None) -> dict:
    now = _now()
    raw_json = json.dumps(item.get("raw") or {})
    tags_json = json.dumps(item.get("tags") or [])
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                INSERT INTO bandcamp_items (
                    bandcamp_item_id, bandcamp_item_type, band_id, album_id, track_id,
                    art_id, artist_name, album_title, track_title, label_name, item_url,
                    artist_url, album_url, cover_url, release_date, tags_json, raw_json,
                    first_seen_at, updated_at
                )
                VALUES (
                    :bandcamp_item_id, :bandcamp_item_type, :band_id, :album_id,
                    :track_id, :art_id, NULLIF(:artist_name, ''),
                    NULLIF(:album_title, ''), NULLIF(:track_title, ''),
                    NULLIF(:label_name, ''), :item_url, NULLIF(:artist_url, ''),
                    NULLIF(:album_url, ''), NULLIF(:cover_url, ''), :release_date,
                    CAST(:tags_json AS jsonb), CAST(:raw_json AS jsonb), :now, :now
                )
                ON CONFLICT (item_url) DO UPDATE SET
                    bandcamp_item_id = COALESCE(EXCLUDED.bandcamp_item_id, bandcamp_items.bandcamp_item_id),
                    bandcamp_item_type = EXCLUDED.bandcamp_item_type,
                    band_id = COALESCE(EXCLUDED.band_id, bandcamp_items.band_id),
                    album_id = COALESCE(EXCLUDED.album_id, bandcamp_items.album_id),
                    track_id = COALESCE(EXCLUDED.track_id, bandcamp_items.track_id),
                    art_id = COALESCE(EXCLUDED.art_id, bandcamp_items.art_id),
                    artist_name = EXCLUDED.artist_name,
                    album_title = EXCLUDED.album_title,
                    track_title = EXCLUDED.track_title,
                    label_name = EXCLUDED.label_name,
                    artist_url = COALESCE(EXCLUDED.artist_url, bandcamp_items.artist_url),
                    album_url = COALESCE(EXCLUDED.album_url, bandcamp_items.album_url),
                    cover_url = COALESCE(EXCLUDED.cover_url, bandcamp_items.cover_url),
                    release_date = COALESCE(EXCLUDED.release_date, bandcamp_items.release_date),
                    tags_json = EXCLUDED.tags_json,
                    raw_json = EXCLUDED.raw_json,
                    updated_at = EXCLUDED.updated_at
                RETURNING *
                """),
                {
                    "bandcamp_item_id": item.get("bandcamp_item_id"),
                    "bandcamp_item_type": item["bandcamp_item_type"],
                    "band_id": item.get("band_id"),
                    "album_id": item.get("album_id"),
                    "track_id": item.get("track_id"),
                    "art_id": item.get("art_id"),
                    "artist_name": item.get("artist_name") or "",
                    "album_title": item.get("album_title") or "",
                    "track_title": item.get("track_title") or "",
                    "label_name": item.get("label_name") or "",
                    "item_url": item["item_url"],
                    "artist_url": item.get("artist_url") or "",
                    "album_url": item.get("album_url") or "",
                    "cover_url": item.get("cover_url") or "",
                    "release_date": item.get("release_date") or None,
                    "tags_json": tags_json,
                    "raw_json": raw_json,
                    "now": now,
                },
            )
            .mappings()
            .one()
        )
    return serialize_row(row)


def upsert_user_bandcamp_item(
    *,
    user_id: int,
    connection_id: int,
    bandcamp_item_id: int,
    relation_type: str,
    owned: bool,
    downloadable: bool,
    purchase_date: str | None = None,
    added_at: str | None = None,
    raw: dict[str, Any] | None = None,
    session=None,
) -> dict:
    now = _now()
    raw_json = json.dumps(raw or {})
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                INSERT INTO user_bandcamp_items (
                    user_id, connection_id, bandcamp_item_id, relation_type, owned,
                    downloadable, purchase_date, added_at, last_seen_at, removed_at,
                    raw_json
                )
                VALUES (
                    :user_id, :connection_id, :bandcamp_item_id, :relation_type,
                    :owned, :downloadable, :purchase_date, :added_at, :now, NULL,
                    CAST(:raw_json AS jsonb)
                )
                ON CONFLICT (user_id, bandcamp_item_id, relation_type) DO UPDATE SET
                    connection_id = EXCLUDED.connection_id,
                    owned = EXCLUDED.owned,
                    downloadable = EXCLUDED.downloadable,
                    purchase_date = COALESCE(EXCLUDED.purchase_date, user_bandcamp_items.purchase_date),
                    added_at = COALESCE(EXCLUDED.added_at, user_bandcamp_items.added_at),
                    last_seen_at = EXCLUDED.last_seen_at,
                    removed_at = NULL,
                    raw_json = EXCLUDED.raw_json
                RETURNING *
                """),
                {
                    "user_id": user_id,
                    "connection_id": connection_id,
                    "bandcamp_item_id": bandcamp_item_id,
                    "relation_type": relation_type,
                    "owned": owned,
                    "downloadable": downloadable,
                    "purchase_date": purchase_date,
                    "added_at": added_at,
                    "raw_json": raw_json,
                    "now": now,
                },
            )
            .mappings()
            .one()
        )
    return serialize_row(row)


def mark_user_bandcamp_items_removed(
    *,
    user_id: int,
    relation_type: str,
    seen_item_ids: list[int],
    session=None,
) -> int:
    now = _now()
    with optional_scope(session) as s:
        result = s.execute(
            text("""
            UPDATE user_bandcamp_items
            SET removed_at = :now
            WHERE user_id = :user_id
              AND relation_type = :relation_type
              AND removed_at IS NULL
              AND NOT (bandcamp_item_id = ANY(:seen_item_ids))
            """),
            {
                "user_id": user_id,
                "relation_type": relation_type,
                "seen_item_ids": seen_item_ids or [-1],
                "now": now,
            },
        )
        return _rowcount(result)


def get_user_owned_bandcamp_item(
    *,
    user_id: int,
    bandcamp_item_id: int,
    session=None,
) -> dict | None:
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                SELECT
                    ubi.id AS user_item_id,
                    ubi.user_id,
                    ubi.connection_id,
                    ubi.relation_type,
                    ubi.owned,
                    ubi.downloadable,
                    bi.*
                FROM user_bandcamp_items ubi
                JOIN bandcamp_items bi ON bi.id = ubi.bandcamp_item_id
                WHERE ubi.user_id = :user_id
                  AND ubi.bandcamp_item_id = :bandcamp_item_id
                  AND ubi.relation_type = 'collection'
                  AND ubi.removed_at IS NULL
                LIMIT 1
                """),
                {"user_id": user_id, "bandcamp_item_id": bandcamp_item_id},
            )
            .mappings()
            .first()
        )
    return serialize_row(row) if row else None


def create_bandcamp_import(
    *,
    user_id: int,
    connection_id: int,
    bandcamp_item_id: int,
    requested_format: str = "flac",
    session=None,
) -> dict:
    now = _now()
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                INSERT INTO bandcamp_imports (
                    user_id, connection_id, bandcamp_item_id, requested_format,
                    status, created_at
                )
                VALUES (
                    :user_id, :connection_id, :bandcamp_item_id, :requested_format,
                    'queued', :created_at
                )
                RETURNING *
                """),
                {
                    "user_id": user_id,
                    "connection_id": connection_id,
                    "bandcamp_item_id": bandcamp_item_id,
                    "requested_format": requested_format,
                    "created_at": now,
                },
            )
            .mappings()
            .one()
        )
    return serialize_row(row)


def get_latest_bandcamp_import_for_item(
    *,
    user_id: int,
    bandcamp_item_id: int,
    session=None,
) -> dict | None:
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                SELECT *
                FROM bandcamp_imports
                WHERE user_id = :user_id
                  AND bandcamp_item_id = :bandcamp_item_id
                ORDER BY created_at DESC
                LIMIT 1
                """),
                {"user_id": user_id, "bandcamp_item_id": bandcamp_item_id},
            )
            .mappings()
            .first()
        )
    return serialize_row(row) if row else None


def get_existing_bandcamp_library_import(
    *,
    bandcamp_item_id: int,
    session=None,
) -> dict | None:
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                SELECT
                    bci.*,
                    u.email AS user_email,
                    u.username AS user_username,
                    u.name AS user_name
                FROM bandcamp_imports bci
                JOIN users u ON u.id = bci.user_id
                WHERE bci.bandcamp_item_id = :bandcamp_item_id
                  AND bci.status = 'completed'
                  AND bci.imported_album_uid IS NOT NULL
                ORDER BY bci.completed_at ASC NULLS LAST, bci.created_at ASC
                LIMIT 1
                """),
                {"bandcamp_item_id": bandcamp_item_id},
            )
            .mappings()
            .first()
        )
    return serialize_row(row) if row else None


def get_bandcamp_global_import_guard(
    *,
    bandcamp_item_id: int,
    artist_name: str = "",
    album_title: str = "",
    exclude_import_id: int | None = None,
    session=None,
) -> dict | None:
    """Return an active/completed import that should prevent duplicate ingestion."""

    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                SELECT
                    bci.*,
                    bi.artist_name,
                    bi.album_title,
                    u.email AS user_email,
                    u.username AS user_username,
                    u.name AS user_name
                FROM bandcamp_imports bci
                JOIN bandcamp_items bi ON bi.id = bci.bandcamp_item_id
                JOIN users u ON u.id = bci.user_id
                WHERE bci.status IN ('queued', 'downloading', 'importing', 'completed')
                  AND (:exclude_import_id IS NULL OR bci.id != :exclude_import_id)
                  AND (
                    bci.bandcamp_item_id = :bandcamp_item_id
                    OR (
                      :artist_name != ''
                      AND :album_title != ''
                      AND LOWER(COALESCE(bi.artist_name, '')) = LOWER(:artist_name)
                      AND LOWER(COALESCE(bi.album_title, '')) = LOWER(:album_title)
                    )
                  )
                ORDER BY
                    CASE bci.status
                      WHEN 'completed' THEN 0
                      WHEN 'importing' THEN 1
                      WHEN 'downloading' THEN 2
                      ELSE 3
                    END,
                    bci.completed_at ASC NULLS LAST,
                    bci.created_at ASC
                LIMIT 1
                """),
                {
                    "bandcamp_item_id": bandcamp_item_id,
                    "artist_name": artist_name.strip(),
                    "album_title": album_title.strip(),
                    "exclude_import_id": exclude_import_id,
                },
            )
            .mappings()
            .first()
        )
    return serialize_row(row) if row else None


def set_bandcamp_import_task(
    import_id: int,
    task_id: str,
    *,
    session=None,
) -> None:
    with optional_scope(session) as s:
        s.execute(
            text("""
            UPDATE bandcamp_imports
            SET task_id = :task_id
            WHERE id = :import_id
            """),
            {"import_id": import_id, "task_id": task_id},
        )


def update_bandcamp_import_status(
    import_id: int,
    *,
    status: str,
    error: str | None = None,
    source_archive_url: str | None = None,
    imported_artist_uid: str | None = None,
    imported_album_uid: str | None = None,
    imported_track_uids: list[str] | None = None,
    session=None,
) -> None:
    completed = status in {"completed", "failed", "skipped", "withdrawn"}
    with optional_scope(session) as s:
        s.execute(
            text("""
            UPDATE bandcamp_imports
            SET status = :status,
                error = :error,
                source_archive_url = COALESCE(:source_archive_url, source_archive_url),
                imported_artist_uid = COALESCE(:imported_artist_uid, imported_artist_uid),
                imported_album_uid = COALESCE(:imported_album_uid, imported_album_uid),
                imported_track_uids = COALESCE(:imported_track_uids, imported_track_uids),
                completed_at = CASE WHEN :completed THEN NOW() ELSE completed_at END
            WHERE id = :import_id
            """),
            {
                "import_id": import_id,
                "status": status,
                "error": error[:1000] if error else None,
                "source_archive_url": source_archive_url,
                "imported_artist_uid": imported_artist_uid,
                "imported_album_uid": imported_album_uid,
                "imported_track_uids": imported_track_uids,
                "completed": completed,
            },
        )


def mark_bandcamp_imports_withdrawn(
    *,
    user_id: int,
    bandcamp_item_id: int,
    session=None,
) -> int:
    with optional_scope(session) as s:
        result = s.execute(
            text("""
            UPDATE bandcamp_imports
            SET status = 'withdrawn',
                completed_at = NOW()
            WHERE user_id = :user_id
              AND bandcamp_item_id = :bandcamp_item_id
              AND status IN ('queued', 'downloading', 'importing', 'completed', 'skipped')
            """),
            {"user_id": user_id, "bandcamp_item_id": bandcamp_item_id},
        )
    return _rowcount(result)


def get_bandcamp_import(
    import_id: int, *, user_id: int | None = None, session=None
) -> dict | None:
    query = """
        SELECT
            bci.*,
            bi.artist_name,
            bi.album_title,
            bi.track_title,
            bi.item_url,
            bi.cover_url
        FROM bandcamp_imports bci
        JOIN bandcamp_items bi ON bi.id = bci.bandcamp_item_id
        WHERE bci.id = :import_id
    """
    params: dict[str, Any] = {"import_id": import_id}
    if user_id is not None:
        query += " AND bci.user_id = :user_id"
        params["user_id"] = user_id
    with optional_scope(session) as s:
        row = s.execute(text(query), params).mappings().first()
    return serialize_row(row) if row else None


def list_bandcamp_imports(
    user_id: int,
    *,
    limit: int = 100,
    session=None,
) -> list[dict]:
    with optional_scope(session) as s:
        rows = (
            s.execute(
                text("""
                SELECT
                    bci.*,
                    bi.artist_name,
                    bi.album_title,
                    bi.track_title,
                    bi.item_url,
                    bi.cover_url
                FROM bandcamp_imports bci
                JOIN bandcamp_items bi ON bi.id = bci.bandcamp_item_id
                WHERE bci.user_id = :user_id
                ORDER BY bci.created_at DESC
                LIMIT :limit
                """),
                {"user_id": user_id, "limit": limit},
            )
            .mappings()
            .all()
        )
    return [serialize_row(row) for row in rows]


def upsert_bandcamp_library_match(
    *,
    bandcamp_item_id: int,
    entity_type: str,
    entity_uid: str,
    confidence: float,
    status: str,
    source: str,
    evidence: dict[str, Any] | None = None,
    session=None,
) -> dict:
    now = _now()
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                INSERT INTO bandcamp_library_matches (
                    bandcamp_item_id, entity_type, entity_uid, confidence, status,
                    source, evidence_json, created_at, updated_at
                )
                VALUES (
                    :bandcamp_item_id, :entity_type, CAST(:entity_uid AS uuid),
                    :confidence, :status, :source, CAST(:evidence_json AS jsonb),
                    :created_at, :updated_at
                )
                ON CONFLICT (bandcamp_item_id, entity_type, entity_uid)
                DO UPDATE SET
                    confidence = EXCLUDED.confidence,
                    status = EXCLUDED.status,
                    source = EXCLUDED.source,
                    evidence_json = EXCLUDED.evidence_json,
                    updated_at = EXCLUDED.updated_at
                RETURNING *
                """),
                {
                    "bandcamp_item_id": bandcamp_item_id,
                    "entity_type": entity_type,
                    "entity_uid": entity_uid,
                    "confidence": confidence,
                    "status": status,
                    "source": source,
                    "evidence_json": json.dumps(evidence or {}),
                    "created_at": now,
                    "updated_at": now,
                },
            )
            .mappings()
            .one()
        )
        _sync_confirmed_bandcamp_entity_url(s, row)
    return serialize_row(row)


def set_bandcamp_library_match_status(
    match_id: int,
    *,
    status: str,
    session=None,
) -> dict | None:
    now = _now()
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                UPDATE bandcamp_library_matches
                SET status = :status, updated_at = :updated_at
                WHERE id = :match_id
                RETURNING *
                """),
                {"match_id": match_id, "status": status, "updated_at": now},
            )
            .mappings()
            .first()
        )
        if row:
            _sync_confirmed_bandcamp_entity_url(s, row)
    return serialize_row(row) if row else None


def list_bandcamp_library_matches(
    *,
    status: str = "",
    limit: int = 100,
    session=None,
) -> list[dict]:
    with optional_scope(session) as s:
        rows = (
            s.execute(
                text("""
                SELECT
                    blm.id,
                    blm.entity_type,
                    blm.entity_uid::text AS entity_uid,
                    blm.confidence,
                    blm.status,
                    blm.source,
                    blm.evidence_json,
                    blm.created_at,
                    blm.updated_at,
                    bi.id AS bandcamp_item_id,
                    bi.bandcamp_item_type,
                    bi.artist_name,
                    bi.album_title,
                    bi.track_title,
                    bi.item_url,
                    bi.artist_url,
                    bi.album_url,
                    bi.cover_url,
                    COALESCE(la.name, lalb.name, blm.entity_uid::text) AS entity_name,
                    lalb.artist AS entity_artist
                FROM bandcamp_library_matches blm
                JOIN bandcamp_items bi ON bi.id = blm.bandcamp_item_id
                LEFT JOIN library_artists la
                  ON blm.entity_type = 'artist'
                 AND la.entity_uid = blm.entity_uid
                LEFT JOIN library_albums lalb
                  ON blm.entity_type = 'album'
                 AND lalb.entity_uid = blm.entity_uid
                WHERE (:status = '' OR blm.status = :status)
                ORDER BY
                    CASE blm.status
                        WHEN 'candidate' THEN 0
                        WHEN 'confirmed' THEN 1
                        ELSE 2
                    END,
                    blm.updated_at DESC
                LIMIT :limit
                """),
                {
                    "status": status,
                    "limit": limit,
                },
            )
            .mappings()
            .all()
        )
    return [serialize_row(row) for row in rows]


def get_bandcamp_link_for_entity(
    *,
    entity_type: str,
    entity_uid: str,
    user_id: int | None = None,
    session=None,
) -> dict | None:
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                SELECT
                    blm.id AS match_id,
                    blm.entity_type,
                    blm.entity_uid::text AS entity_uid,
                    blm.confidence,
                    blm.status AS match_status,
                    blm.source AS match_source,
                    blm.evidence_json,
                    bi.id AS bandcamp_item_id,
                    bi.bandcamp_item_type,
                    bi.item_url,
                    bi.artist_url,
                    bi.album_url,
                    bi.cover_url,
                    bi.artist_name,
                    bi.album_title,
                    bi.track_title,
                    ubi.owned AS user_owned,
                    ubi.downloadable AS user_downloadable,
                    latest_import.status AS latest_import_status,
                    latest_import.id AS latest_import_id
                FROM bandcamp_library_matches blm
                JOIN bandcamp_items bi ON bi.id = blm.bandcamp_item_id
                LEFT JOIN LATERAL (
                    SELECT owned, downloadable
                    FROM user_bandcamp_items
                    WHERE user_id = :user_id
                      AND bandcamp_item_id = bi.id
                      AND relation_type = 'collection'
                      AND removed_at IS NULL
                    ORDER BY last_seen_at DESC
                    LIMIT 1
                ) ubi ON :user_id IS NOT NULL
                LEFT JOIN LATERAL (
                    SELECT id, status
                    FROM bandcamp_imports
                    WHERE user_id = :user_id
                      AND bandcamp_item_id = bi.id
                    ORDER BY created_at DESC
                    LIMIT 1
                ) latest_import ON :user_id IS NOT NULL
                WHERE blm.entity_type = :entity_type
                  AND blm.entity_uid = CAST(:entity_uid AS uuid)
                  AND blm.status = 'confirmed'
                ORDER BY blm.confidence DESC, blm.updated_at DESC
                LIMIT 1
                """),
                {
                    "entity_type": entity_type,
                    "entity_uid": entity_uid,
                    "user_id": user_id,
                },
            )
            .mappings()
            .first()
        )
        if row:
            return serialize_row(row)
        fallback = _persisted_bandcamp_link_for_entity(
            s,
            entity_type=entity_type,
            entity_uid=entity_uid,
        )
    return serialize_row(fallback) if fallback else None


def list_bandcamp_item_ids(*, limit: int = 10000, session=None) -> list[int]:
    capped_limit = max(1, min(int(limit), 50000))
    with optional_scope(session) as s:
        rows = (
            s.execute(
                text("""
                SELECT id
                FROM bandcamp_items
                ORDER BY updated_at DESC, id DESC
                LIMIT :limit
                """),
                {"limit": capped_limit},
            )
            .mappings()
            .all()
        )
    return [int(row["id"]) for row in rows]


def backfill_confirmed_bandcamp_entity_urls(
    *,
    limit: int = 10000,
    session=None,
) -> dict[str, int]:
    capped_limit = max(1, min(int(limit), 50000))
    with optional_scope(session) as s:
        rows = (
            s.execute(
                text("""
                SELECT *
                FROM bandcamp_library_matches
                WHERE status = 'confirmed'
                  AND entity_type IN ('artist', 'album')
                ORDER BY updated_at DESC, id DESC
                LIMIT :limit
                """),
                {"limit": capped_limit},
            )
            .mappings()
            .all()
        )
        updated = 0
        for row in rows:
            if _sync_confirmed_bandcamp_entity_url(s, row):
                updated += 1
    return {"scanned": len(rows), "updated": updated}


def list_library_artists_missing_bandcamp_urls(
    *,
    limit: int = 100,
    session=None,
) -> list[dict]:
    capped_limit = max(1, min(int(limit), 5000))
    with optional_scope(session) as s:
        rows = (
            s.execute(
                text("""
                SELECT entity_uid::text AS entity_uid, name, urls_json
                FROM library_artists
                WHERE entity_uid IS NOT NULL
                  AND NULLIF(trim(coalesce(name, '')), '') IS NOT NULL
                  AND NULLIF(trim(coalesce(bandcamp_url, '')), '') IS NULL
                ORDER BY album_count DESC NULLS LAST, name ASC
                LIMIT :limit
                """),
                {"limit": capped_limit},
            )
            .mappings()
            .all()
        )
    return [serialize_row(row) for row in rows]


def list_library_albums_missing_bandcamp_urls(
    *,
    limit: int = 100,
    session=None,
) -> list[dict]:
    capped_limit = max(1, min(int(limit), 5000))
    with optional_scope(session) as s:
        rows = (
            s.execute(
                text("""
                SELECT
                    alb.entity_uid::text AS entity_uid,
                    alb.artist,
                    alb.name,
                    la.bandcamp_url AS artist_bandcamp_url,
                    la.urls_json AS artist_urls_json
                FROM library_albums alb
                LEFT JOIN library_artists la ON la.name = alb.artist
                WHERE alb.entity_uid IS NOT NULL
                  AND NULLIF(trim(coalesce(alb.artist, '')), '') IS NOT NULL
                  AND NULLIF(trim(coalesce(alb.name, '')), '') IS NOT NULL
                  AND NULLIF(trim(coalesce(alb.bandcamp_url, '')), '') IS NULL
                ORDER BY alb.year DESC NULLS LAST, alb.artist ASC, alb.name ASC
                LIMIT :limit
                """),
                {"limit": capped_limit},
            )
            .mappings()
            .all()
        )
    return [serialize_row(row) for row in rows]


def set_library_entity_bandcamp_url(
    *,
    entity_type: str,
    entity_uid: str,
    url: str,
    source: str,
    session=None,
) -> bool:
    keep_path = entity_type == "album"
    cleaned_url = _clean_bandcamp_url(url, keep_path=keep_path)
    if not cleaned_url or entity_type not in {"artist", "album"}:
        return False
    table = "library_artists" if entity_type == "artist" else "library_albums"
    now = _now()
    with optional_scope(session) as s:
        result = s.execute(
            text(f"""
            UPDATE {table}
            SET bandcamp_url = :url,
                bandcamp_url_source = :source,
                bandcamp_url_updated_at = :updated_at
            WHERE entity_uid = CAST(:entity_uid AS uuid)
              AND NULLIF(trim(coalesce(bandcamp_url, '')), '') IS NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM library_field_locks l
                  WHERE l.entity_type = :entity_type
                    AND l.entity_id = {table}.id
                    AND l.field_name = 'bandcamp_url'
              )
            """),
            {
                "entity_uid": entity_uid,
                "entity_type": entity_type,
                "url": cleaned_url,
                "source": source,
                "updated_at": now,
            },
        )
    return bool(_rowcount(result))


def list_bandcamp_match_candidates_for_name(
    *,
    entity_type: str,
    artist_name: str,
    album_title: str = "",
    limit: int = 10,
    session=None,
) -> list[dict]:
    with optional_scope(session) as s:
        rows = (
            s.execute(
                text("""
                SELECT *
                FROM bandcamp_items
                WHERE lower(coalesce(artist_name, '')) = lower(:artist_name)
                  AND (
                    :album_title = ''
                    OR lower(coalesce(album_title, '')) = lower(:album_title)
                  )
                  AND (
                    (:entity_type = 'artist' AND bandcamp_item_type IN ('artist', 'album', 'track'))
                    OR (:entity_type = 'album' AND bandcamp_item_type IN ('album', 'track'))
                    OR (:entity_type = 'track' AND bandcamp_item_type = 'track')
                  )
                ORDER BY updated_at DESC
                LIMIT :limit
                """),
                {
                    "entity_type": entity_type,
                    "artist_name": artist_name,
                    "album_title": album_title,
                    "limit": limit,
                },
            )
            .mappings()
            .all()
        )
    return [serialize_row(row) for row in rows]


def refresh_bandcamp_radar_for_user(user_id: int, *, session=None) -> dict[str, int]:
    if not has_active_connection(user_id, session=session):
        return {"upserted": 0}

    now = _now()
    with optional_scope(session) as s:
        rows = (
            s.execute(
                text("""
                SELECT
                    ubi.bandcamp_item_id,
                    ubi.relation_type,
                    bi.artist_name,
                    bi.album_title,
                    bi.track_title
                FROM user_bandcamp_items ubi
                JOIN bandcamp_items bi ON bi.id = ubi.bandcamp_item_id
                WHERE ubi.user_id = :user_id
                  AND ubi.removed_at IS NULL
                  AND ubi.relation_type IN ('wishlist', 'following')
                  AND NOT EXISTS (
                    SELECT 1
                    FROM bandcamp_imports bci
                    WHERE bci.user_id = ubi.user_id
                      AND bci.bandcamp_item_id = ubi.bandcamp_item_id
                      AND bci.status = 'completed'
                  )
                """),
                {"user_id": user_id},
            )
            .mappings()
            .all()
        )
        upserted = 0
        for row in rows:
            source = str(row["relation_type"])
            score = 95.0 if source == "wishlist" else 82.0
            reason = {
                "source": source,
                "artist": row.get("artist_name"),
                "album": row.get("album_title"),
                "track": row.get("track_title"),
            }
            s.execute(
                text("""
                INSERT INTO bandcamp_radar_items (
                    user_id, bandcamp_item_id, scope, source, score, status,
                    reason_json, first_seen_at, updated_at
                )
                VALUES (
                    :user_id, :bandcamp_item_id, 'user', :source, :score, 'new',
                    CAST(:reason_json AS jsonb), :now, :now
                )
                ON CONFLICT (user_id, bandcamp_item_id, source) DO UPDATE SET
                    score = EXCLUDED.score,
                    reason_json = EXCLUDED.reason_json,
                    updated_at = EXCLUDED.updated_at
                """),
                {
                    "user_id": user_id,
                    "bandcamp_item_id": row["bandcamp_item_id"],
                    "source": source,
                    "score": score,
                    "reason_json": json.dumps(reason),
                    "now": now,
                },
            )
            upserted += 1
    return {"upserted": upserted}


def list_bandcamp_radar_items(
    user_id: int,
    *,
    limit: int = 50,
    session=None,
) -> list[dict]:
    if not has_active_connection(user_id, session=session):
        return []

    with optional_scope(session) as s:
        rows = (
            s.execute(
                text("""
                SELECT
                    bri.*,
                    bi.bandcamp_item_type,
                    bi.item_url,
                    bi.artist_url,
                    bi.album_url,
                    bi.cover_url,
                    bi.artist_name,
                    bi.album_title,
                    bi.track_title,
                    ubi.owned AS user_owned,
                    ubi.downloadable AS user_downloadable
                FROM bandcamp_radar_items bri
                JOIN bandcamp_items bi ON bi.id = bri.bandcamp_item_id
                LEFT JOIN user_bandcamp_items ubi
                  ON ubi.user_id = :user_id
                 AND ubi.bandcamp_item_id = bi.id
                 AND ubi.relation_type = 'collection'
                 AND ubi.removed_at IS NULL
                WHERE bri.user_id = :user_id
                  AND bri.status IN ('new', 'saved')
                ORDER BY bri.score DESC, bri.updated_at DESC
                LIMIT :limit
                """),
                {"user_id": user_id, "limit": limit},
            )
            .mappings()
            .all()
        )
    return [serialize_row(row) for row in rows]


def update_bandcamp_radar_status(
    *,
    user_id: int,
    radar_id: int,
    status: str,
    session=None,
) -> dict | None:
    now = _now()
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                UPDATE bandcamp_radar_items
                SET status = :status, updated_at = :updated_at
                WHERE id = :radar_id
                  AND user_id = :user_id
                RETURNING *
                """),
                {
                    "user_id": user_id,
                    "radar_id": radar_id,
                    "status": status,
                    "updated_at": now,
                },
            )
            .mappings()
            .first()
        )
    return serialize_row(row) if row else None
