"""Reconciliation routines for the federated global catalog."""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Mapping
from datetime import datetime, timezone
from itertools import islice
from typing import Any

from sqlalchemy import text

from crate.db.domain_events import append_domain_event
from crate.db.global_catalog_search_projection import (
    upsert_global_catalog_search_document,
)
from crate.db.jobs.global_catalog_routes import (
    claim_album_public_slug,
    claim_artist_public_slug,
)
from crate.db.tx import read_scope, transaction_scope
from crate.db.repositories.global_catalog_decisions import (
    force_merge_target_for_source,
    merge_blocked_for_source,
)
from crate.federation.global_matching import (
    MatchScore,
    normalize_name,
    score_album_match,
    score_artist_match,
    score_track_match,
)
from crate.db.queries.global_catalog_sources import (
    get_local_source,
    get_remote_source,
    iter_local_album_sources,
    iter_local_artist_sources,
    iter_local_track_sources,
    iter_remote_sources,
)
from crate.slugs import build_artist_slug, build_public_album_slug

_GLOBAL_UID_NAMESPACE = uuid.UUID("e43655c7-8af2-4c5a-92f6-a5126dff7f84")
_RECONCILIATION_ENTITY_TYPES = ("artist", "album", "track")
_DEPENDENCY_RETRY_SECONDS = 3600
log = logging.getLogger(__name__)


def apply_federation_delta_page(
    *,
    node_uid: str,
    items: list[dict[str, Any]],
    next_cursor: str,
    last_sequence: int | None = None,
) -> dict[str, int]:
    """Apply a remote delta page and advance its checkpoint atomically."""
    from crate.db.repositories.global_catalog_dirty_sources import (
        enqueue_federated_dirty_source,
    )

    applied = 0
    effective_sequence = max(
        [int(item.get("sequence") or 0) for item in items] + [int(last_sequence or 0)]
    )
    with transaction_scope() as session:
        for item in items:
            entity_type = str(item.get("entity_type") or "")
            entity_uid = str(item.get("remote_entity_uid") or "")
            operation = str(item.get("operation") or "")
            if entity_type not in _RECONCILIATION_ENTITY_TYPES or not entity_uid:
                raise ValueError("Invalid federation delta entity")
            if operation not in {"upsert", "restore", "delete", "hide"}:
                raise ValueError("Invalid federation delta operation")
            payload = dict(item.get("payload") or {})
            deleted = operation in {"delete", "hide"}
            title = str(payload.get("title") or payload.get("name") or "")
            artist = payload.get("artist")
            album = payload.get("album")
            search_text = " ".join(
                value for value in (title, str(artist or ""), str(album or "")) if value
            )
            session.execute(
                text(
                    """
                    INSERT INTO federation_catalog_items (
                        node_uid, remote_entity_uid, entity_type, title, artist,
                        album, year, duration_seconds, track_number, disc_number,
                        remote_revision, raw_json, search_vector, deleted_at,
                        tombstone_json
                    )
                    VALUES (
                        CAST(:node_uid AS uuid), :entity_uid, :entity_type,
                        :title, :artist, :album, :year, :duration_seconds,
                        :track_number, :disc_number, :remote_revision,
                        CAST(:raw_json AS jsonb),
                        to_tsvector('simple', :search_text),
                        CASE WHEN :deleted THEN NOW() ELSE NULL END,
                        CASE WHEN :deleted THEN CAST(:tombstone_json AS jsonb)
                             ELSE '{}'::jsonb END
                    )
                    ON CONFLICT (node_uid, entity_type, remote_entity_uid)
                    DO UPDATE SET
                        title = EXCLUDED.title,
                        artist = EXCLUDED.artist,
                        album = EXCLUDED.album,
                        year = EXCLUDED.year,
                        duration_seconds = EXCLUDED.duration_seconds,
                        track_number = EXCLUDED.track_number,
                        disc_number = EXCLUDED.disc_number,
                        remote_revision = EXCLUDED.remote_revision,
                        raw_json = EXCLUDED.raw_json,
                        search_vector = EXCLUDED.search_vector,
                        deleted_at = EXCLUDED.deleted_at,
                        tombstone_json = EXCLUDED.tombstone_json,
                        indexed_at = NOW()
                    """
                ),
                {
                    "node_uid": node_uid,
                    "entity_uid": entity_uid,
                    "entity_type": entity_type,
                    "title": title,
                    "artist": artist,
                    "album": album,
                    "year": str(payload["year"])
                    if payload.get("year") is not None
                    else None,
                    "duration_seconds": payload.get("duration_seconds"),
                    "track_number": payload.get("track_number"),
                    "disc_number": payload.get("disc_number"),
                    "remote_revision": item.get("payload_revision"),
                    "raw_json": json.dumps(payload, default=str),
                    "search_text": search_text,
                    "deleted": deleted,
                    "tombstone_json": json.dumps(
                        {
                            "reason": operation,
                            "payload_revision": item.get("payload_revision"),
                        }
                    ),
                },
            )
            enqueue_federated_dirty_source(
                entity_type,  # type: ignore[arg-type]
                node_uid,
                entity_uid,
                "delete" if deleted else "upsert",
                source_revision=str(item.get("payload_revision") or ""),
                session=session,
            )
            applied += 1

        session.execute(
            text(
                """
                INSERT INTO federation_catalog_cursors (
                    node_uid, cursor, last_applied_cursor, last_delta_at,
                    consecutive_failures, last_error, retry_after, updated_at
                )
                VALUES (
                    CAST(:node_uid AS uuid), :cursor, :last_sequence, NOW(),
                    0, NULL, NULL, NOW()
                )
                ON CONFLICT (node_uid) DO UPDATE SET
                    cursor = EXCLUDED.cursor,
                    last_applied_cursor = GREATEST(
                        COALESCE(federation_catalog_cursors.last_applied_cursor, 0),
                        EXCLUDED.last_applied_cursor
                    ),
                    last_delta_at = NOW(),
                    consecutive_failures = 0,
                    last_error = NULL,
                    retry_after = NULL,
                    updated_at = NOW()
                """
            ),
            {
                "node_uid": node_uid,
                "cursor": next_cursor,
                "last_sequence": effective_sequence,
            },
        )
    return {"applied": applied, "last_sequence": effective_sequence}


def reconcile_dirty_catalog_sources(*, limit: int = 500) -> dict[str, int]:
    """Project only claimed dirty local sources into the canonical catalog."""
    from crate.db.repositories.global_catalog_dirty_sources import (
        claim_dirty_sources,
        complete_dirty_source,
        fail_dirty_source,
    )

    with transaction_scope() as session:
        claimed = claim_dirty_sources(limit, session=session)

    completed = 0
    failed = 0
    for dirty in claimed:
        source_id = int(dirty["id"])
        try:
            with transaction_scope() as session:
                _reconcile_dirty_source(session, dirty)
                complete_dirty_source(
                    source_id,
                    requested_at=dirty["requested_at"],
                    claimed_at=dirty["claimed_at"],
                    session=session,
                )
            completed += 1
        except Exception as exc:
            with transaction_scope() as session:
                fail_dirty_source(
                    source_id,
                    str(exc),
                    requested_at=dirty["requested_at"],
                    claimed_at=dirty["claimed_at"],
                    retry_after_seconds=(
                        _DEPENDENCY_RETRY_SECONDS
                        if "waiting for its canonical artist" in str(exc)
                        else None
                    ),
                    session=session,
                )
            failed += 1

    with read_scope() as session:
        remaining = session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM global_catalog_dirty_sources
                WHERE completed_at IS NULL
                  AND claimed_at IS NULL
                """
            )
        ).scalar_one()

    return {
        "claimed": len(claimed),
        "completed": completed,
        "failed": failed,
        "remaining": int(remaining),
    }


def _reconcile_dirty_source(session, dirty: dict[str, Any]) -> None:
    entity_type = str(dirty["entity_type"])
    source_kind = str(dirty["source_kind"])
    operation = str(dirty["operation"])

    if source_kind == "local":
        entity_uid = str(dirty.get("local_entity_uid") or "")
        if not entity_uid:
            raise ValueError("Local dirty source is missing entity UID")
        if operation == "delete":
            tombstone_local_source(entity_type, entity_uid, session=session)
            return
        source = get_local_source(entity_type, entity_uid)
        if source is None:
            tombstone_local_source(entity_type, entity_uid, session=session)
            return
        _reconcile_local_source(session, source)
        return

    if source_kind == "federated":
        node_uid = str(dirty.get("node_uid") or "")
        remote_entity_uid = str(dirty.get("remote_entity_uid") or "")
        if not node_uid or not remote_entity_uid:
            raise ValueError(
                "Federated dirty source is missing node or remote entity UID"
            )
        if operation == "delete":
            tombstone_federated_source(
                entity_type,
                node_uid,
                remote_entity_uid,
                session=session,
            )
            return
        source = get_remote_source(node_uid, entity_type, remote_entity_uid)
        if source is None or source["source_stale"]:
            tombstone_federated_source(
                entity_type,
                node_uid,
                remote_entity_uid,
                session=session,
            )
            return
        _reconcile_federated_source(session, source)
        return

    raise ValueError(f"Unsupported dirty source kind: {source_kind}")


def _reconcile_local_source(session, source: dict[str, Any]) -> None:
    entity_type = source["entity_type"]
    if entity_type == "artist":
        global_uid, score = _resolve_artist_target(session, source)
        source = _with_match(source, score)
        _upsert_artist(session, source, global_uid)
    elif entity_type == "album":
        artist_uid = _find_artist_uid(session, source["source_payload"]["artist_name"])
        if artist_uid is None:
            raise RuntimeError("Album source is waiting for its canonical artist")
        global_uid, score = _resolve_album_target(session, source, artist_uid)
        source = _with_match(source, score)
        _upsert_album(session, source, global_uid, artist_uid)
    elif entity_type == "track":
        payload = source["source_payload"]
        album_uid = _find_album_uid(
            session,
            artist_name=payload["artist_name"],
            album_name=payload.get("album_name"),
            local_album_id=payload.get("local_album_id"),
        )
        artist_uid = _find_local_track_artist_uid(
            session,
            album_uid=album_uid,
            track_artist_name=payload["artist_name"],
        )
        if artist_uid is None:
            raise RuntimeError("Track source is waiting for its canonical artist")
        global_uid, score = _resolve_track_target(session, source, artist_uid)
        source = _with_match(source, score)
        _upsert_track(session, source, global_uid, artist_uid, album_uid)
    else:
        raise ValueError(f"Unsupported local catalog entity type: {entity_type}")

    source_id = _upsert_source(session, source, global_uid, preferred=True)
    _project_source_genres(session, source, global_uid, source_id)
    _refresh_source_count(session, entity_type, global_uid)
    upsert_global_catalog_search_document(entity_type, global_uid, session=session)


def _reconcile_federated_source(session, source: dict[str, Any]) -> None:
    """Project one peer source without scanning the peer's full catalog."""
    entity_type = source["entity_type"]
    if entity_type == "artist":
        target_uid, score = _resolve_artist_target(session, source)
        source = _with_match(source, score)
        _upsert_remote_artist(session, source, target_uid)
        preferred = not _canonical_has_local(session, "artist", target_uid)
        source_id = _upsert_source(session, source, target_uid, preferred=preferred)
        _project_source_genres(session, source, target_uid, source_id)
        _refresh_artist_has_photo(session, target_uid)
    elif entity_type == "album":
        artist_uid = _find_artist_uid(session, source["source_payload"]["artist_name"])
        if artist_uid is None:
            raise RuntimeError(
                "Federated album source is waiting for its canonical artist"
            )
        target_uid, score = _resolve_album_target(session, source, artist_uid)
        source = _with_match(source, score)
        _upsert_remote_album(session, source, target_uid, artist_uid)
        preferred = not _canonical_has_local(session, "album", target_uid)
        source_id = _upsert_source(session, source, target_uid, preferred=preferred)
        _project_source_genres(session, source, target_uid, source_id)
    elif entity_type == "track":
        payload = source["source_payload"]
        artist_uid = _find_artist_uid(session, payload["artist_name"])
        if artist_uid is None:
            raise RuntimeError(
                "Federated track source is waiting for its canonical artist"
            )
        album_uid = _find_album_uid(
            session,
            artist_name=payload["artist_name"],
            album_name=payload.get("album_name"),
        )
        target_uid, score = _resolve_track_target(session, source, artist_uid)
        source = _with_match(source, score)
        _upsert_remote_track(session, source, target_uid, artist_uid, album_uid)
        preferred = not _canonical_has_local(session, "track", target_uid)
        source_id = _upsert_source(session, source, target_uid, preferred=preferred)
        _project_source_genres(session, source, target_uid, source_id)
    else:
        raise ValueError(f"Unsupported federated catalog entity type: {entity_type}")
    _refresh_source_count(session, entity_type, target_uid)
    upsert_global_catalog_search_document(entity_type, target_uid, session=session)


def tombstone_local_source(entity_type: str, entity_uid: str, *, session) -> None:
    """Mark a local source deleted and remove its canonical row when orphaned."""
    table_name, id_column = _canonical_table(entity_type)
    row = (
        session.execute(
            text(
                """
                SELECT id, global_entity_uid::text AS global_entity_uid
                FROM global_catalog_sources
                WHERE entity_type = :entity_type
                  AND source_kind = 'local'
                  AND local_entity_uid = CAST(:entity_uid AS uuid)
                LIMIT 1
                """
            ),
            {"entity_type": entity_type, "entity_uid": entity_uid},
        )
        .mappings()
        .first()
    )
    if row is None:
        return

    global_uid = str(row["global_entity_uid"])
    session.execute(
        text(
            """
            UPDATE global_catalog_sources
            SET
                source_deleted_at = NOW(),
                source_stale = TRUE,
                preferred_for_display = FALSE,
                preferred_for_artwork = FALSE,
                preferred_for_playback = FALSE,
                updated_at = NOW()
            WHERE entity_type = :entity_type
              AND source_kind = 'local'
              AND local_entity_uid = CAST(:entity_uid AS uuid)
            """
        ),
        {"entity_type": entity_type, "entity_uid": entity_uid},
    )
    from crate.db.jobs.global_catalog_genres import project_source_genre_assertions

    project_source_genre_assertions(
        session,
        source_id=int(row["id"]),
        entity_type=entity_type,
        global_entity_uid=global_uid,
        source_kind="local",
        source_revision=None,
        assertions=[],
    )
    _refresh_source_count(session, entity_type, global_uid)
    active_sources = session.execute(
        text(
            """
            SELECT COUNT(*)
            FROM global_catalog_sources
            WHERE entity_type = :entity_type
              AND global_entity_uid = CAST(:global_uid AS uuid)
              AND source_deleted_at IS NULL
              AND NOT source_stale
            """
        ),
        {"entity_type": entity_type, "global_uid": global_uid},
    ).scalar_one()
    if int(active_sources) == 0:
        session.execute(
            text(
                f"DELETE FROM {table_name} WHERE {id_column} = CAST(:global_uid AS uuid)"
            ),
            {"global_uid": global_uid},
        )
    upsert_global_catalog_search_document(entity_type, global_uid, session=session)


def tombstone_federated_source(
    entity_type: str,
    node_uid: str,
    remote_entity_uid: str,
    *,
    session,
) -> None:
    """Invalidate a peer source and prune an orphaned canonical row."""
    table_name, id_column = _canonical_table(entity_type)
    row = (
        session.execute(
            text(
                """
                SELECT id, global_entity_uid::text AS global_entity_uid
                FROM global_catalog_sources
                WHERE entity_type = :entity_type
                  AND source_kind = 'federated'
                  AND node_uid = CAST(:node_uid AS uuid)
                  AND remote_entity_uid = :remote_entity_uid
                LIMIT 1
                """
            ),
            {
                "entity_type": entity_type,
                "node_uid": node_uid,
                "remote_entity_uid": remote_entity_uid,
            },
        )
        .mappings()
        .first()
    )
    if row is None:
        return

    global_uid = str(row["global_entity_uid"])
    session.execute(
        text(
            """
            UPDATE global_catalog_sources
            SET
                source_deleted_at = NOW(),
                source_stale = TRUE,
                preferred_for_display = FALSE,
                preferred_for_artwork = FALSE,
                preferred_for_playback = FALSE,
                updated_at = NOW()
            WHERE id = :source_id
            """
        ),
        {"source_id": row["id"]},
    )
    from crate.db.jobs.global_catalog_genres import project_source_genre_assertions

    project_source_genre_assertions(
        session,
        source_id=int(row["id"]),
        entity_type=entity_type,
        global_entity_uid=global_uid,
        source_kind="federated",
        source_revision=None,
        assertions=[],
    )
    _refresh_source_count(session, entity_type, global_uid)
    active_sources = session.execute(
        text(
            """
            SELECT COUNT(*)
            FROM global_catalog_sources
            WHERE entity_type = :entity_type
              AND global_entity_uid = CAST(:global_uid AS uuid)
              AND source_deleted_at IS NULL
              AND NOT source_stale
            """
        ),
        {"entity_type": entity_type, "global_uid": global_uid},
    ).scalar_one()
    if int(active_sources) == 0:
        session.execute(
            text(
                f"DELETE FROM {table_name} WHERE {id_column} = CAST(:global_uid AS uuid)"
            ),
            {"global_uid": global_uid},
        )
    upsert_global_catalog_search_document(entity_type, global_uid, session=session)


def reconcile_local_catalog(batch_size: int = 500) -> dict[str, Any]:
    """Reconcile every local source using bounded source transactions."""
    return _reconcile_catalog_until_complete("local", batch_size=batch_size)


def reconcile_remote_catalog(
    batch_size: int = 500,
    node_uid: str | None = None,
) -> dict[str, Any]:
    """Reconcile every federated source using bounded source transactions."""
    return _reconcile_catalog_until_complete(
        "remote", batch_size=batch_size, node_uid=node_uid
    )


def reconcile_local_catalog_batch(
    *,
    batch_size: int = 500,
    cursor: dict[str, Any] | None = None,
    recompute_matches: bool = False,
) -> dict[str, Any]:
    """Project one durable, dependency-ordered batch of local sources."""
    entity_type, after_id = _reconciliation_cursor(cursor)
    sources = _local_batch_sources(entity_type, after_id, batch_size)
    result = _new_batch_result("local", len(sources))
    if sources:
        _reconcile_local_batch_sources(
            sources,
            result,
            recompute_matches=recompute_matches,
        )
    return _complete_batch_result(result, entity_type, after_id, sources, batch_size)


def reconcile_remote_catalog_batch(
    *,
    batch_size: int = 500,
    cursor: dict[str, Any] | None = None,
    node_uid: str | None = None,
    recompute_matches: bool = False,
) -> dict[str, Any]:
    """Project one durable, dependency-ordered batch of federated sources."""
    entity_type, after_id = _reconciliation_cursor(cursor)
    sources = list(
        islice(
            iter_remote_sources(
                batch_size=batch_size,
                node_uid=node_uid,
                entity_type=entity_type,
                after_id=after_id,
            ),
            max(1, batch_size),
        )
    )
    result = _new_batch_result("peer" if node_uid else "incremental", len(sources))
    if sources:
        _reconcile_remote_batch_sources(
            sources,
            result,
            recompute_matches=recompute_matches,
        )
    return _complete_batch_result(result, entity_type, after_id, sources, batch_size)


def prune_local_catalog_sources_batch(
    *, batch_size: int = 500, cursor: int | None = None
) -> dict[str, Any]:
    """Tombstone one keyset batch of local sources missing from ``library_*``."""
    after_id = max(0, int(cursor or 0))
    capped_batch = max(1, int(batch_size))
    with transaction_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT id, entity_type, local_entity_uid::text AS local_entity_uid
                    FROM global_catalog_sources source
                    WHERE source.source_kind = 'local'
                      AND source.source_deleted_at IS NULL
                      AND source.id > :after_id
                      AND (
                        (
                          source.entity_type = 'artist'
                          AND NOT EXISTS (
                            SELECT 1 FROM library_artists item
                            WHERE item.entity_uid = source.local_entity_uid
                          )
                        )
                        OR (
                          source.entity_type = 'album'
                          AND NOT EXISTS (
                            SELECT 1 FROM library_albums item
                            WHERE item.entity_uid = source.local_entity_uid
                              AND item.quarantined_at IS NULL
                          )
                        )
                        OR (
                          source.entity_type = 'track'
                          AND NOT EXISTS (
                            SELECT 1 FROM library_tracks item
                            WHERE item.entity_uid = source.local_entity_uid
                          )
                        )
                      )
                    ORDER BY source.id
                    LIMIT :limit
                    """
                ),
                {"after_id": after_id, "limit": capped_batch},
            )
            .mappings()
            .all()
        )
        for row in rows:
            tombstone_local_source(
                str(row["entity_type"]),
                str(row["local_entity_uid"]),
                session=session,
            )

    next_cursor = int(rows[-1]["id"]) if len(rows) >= capped_batch else None
    return {
        "mode": "local_prune",
        "source_rows_seen": len(rows),
        "sources_pruned": len(rows),
        "completed": next_cursor is None,
        "next_cursor": next_cursor,
    }


def prune_remote_catalog_sources_batch(
    *, batch_size: int = 500, cursor: int | None = None
) -> dict[str, Any]:
    """Tombstone one keyset batch no longer backed by an approved peer item."""
    after_id = max(0, int(cursor or 0))
    capped_batch = max(1, int(batch_size))
    with transaction_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT
                        source.id,
                        source.entity_type,
                        source.node_uid::text AS node_uid,
                        source.remote_entity_uid
                    FROM global_catalog_sources source
                    WHERE source.source_kind = 'federated'
                      AND source.source_deleted_at IS NULL
                      AND source.id > :after_id
                      AND NOT EXISTS (
                        SELECT 1
                        FROM federation_catalog_items item
                        JOIN federation_nodes peer ON peer.node_uid = item.node_uid
                        WHERE item.node_uid = source.node_uid
                          AND item.entity_type = source.entity_type
                          AND item.remote_entity_uid = source.remote_entity_uid
                          AND item.deleted_at IS NULL
                          AND peer.trust_state = 'approved'
                          AND peer.disabled_at IS NULL
                      )
                    ORDER BY source.id
                    LIMIT :limit
                    """
                ),
                {"after_id": after_id, "limit": capped_batch},
            )
            .mappings()
            .all()
        )
        for row in rows:
            tombstone_federated_source(
                str(row["entity_type"]),
                str(row["node_uid"]),
                str(row["remote_entity_uid"]),
                session=session,
            )

    next_cursor = int(rows[-1]["id"]) if len(rows) >= capped_batch else None
    return {
        "mode": "remote_prune",
        "source_rows_seen": len(rows),
        "sources_pruned": len(rows),
        "completed": next_cursor is None,
        "next_cursor": next_cursor,
    }


def _reconcile_catalog_until_complete(
    kind: str,
    *,
    batch_size: int,
    node_uid: str | None = None,
) -> dict[str, Any]:
    mode = "local" if kind == "local" else ("peer" if node_uid else "incremental")
    run_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc)
    _emit_reconcile_event("started", run_id=run_id, mode=mode, node_uid=node_uid)
    result = _new_batch_result(mode, 0)
    result.update({"run_id": run_id, "status": "completed"})
    cursor: dict[str, Any] | None = None
    try:
        with transaction_scope() as session:
            _insert_run(session, run_id=run_id, mode=mode, started_at=started_at)

        while True:
            batch = (
                reconcile_local_catalog_batch(batch_size=batch_size, cursor=cursor)
                if kind == "local"
                else reconcile_remote_catalog_batch(
                    batch_size=batch_size,
                    cursor=cursor,
                    node_uid=node_uid,
                )
            )
            _merge_batch_result(result, batch)
            if batch["completed"]:
                break
            cursor = batch["next_cursor"]

        prune_cursor: int | None = None
        while True:
            prune = (
                prune_local_catalog_sources_batch(
                    batch_size=batch_size, cursor=prune_cursor
                )
                if kind == "local"
                else prune_remote_catalog_sources_batch(
                    batch_size=batch_size, cursor=prune_cursor
                )
            )
            result["sources_pruned"] = int(result.get("sources_pruned") or 0) + int(
                prune["sources_pruned"]
            )
            if prune["completed"]:
                break
            prune_cursor = int(prune["next_cursor"])

        with transaction_scope() as session:
            _complete_run(session, run_id=run_id, result=result)
            _emit_reconcile_event("completed", result=result, session=session)
        return result
    except Exception as exc:
        try:
            with transaction_scope() as session:
                _fail_run(session, run_id=run_id, error=str(exc))
        except Exception:
            log.exception(
                "Failed to persist global catalog reconciliation failure",
                extra={"run_id": run_id, "mode": mode},
            )
        _emit_reconcile_event("failed", run_id=run_id, mode=mode, error=str(exc))
        raise


def _reconciliation_cursor(cursor: dict[str, Any] | None) -> tuple[str, int]:
    if not isinstance(cursor, dict):
        return _RECONCILIATION_ENTITY_TYPES[0], 0
    entity_type = str(cursor.get("entity_type") or "")
    if entity_type not in _RECONCILIATION_ENTITY_TYPES:
        return _RECONCILIATION_ENTITY_TYPES[0], 0
    try:
        after_id = max(0, int(cursor.get("after_id") or 0))
    except (TypeError, ValueError):
        after_id = 0
    return entity_type, after_id


def _local_batch_sources(
    entity_type: str, after_id: int, batch_size: int
) -> list[dict[str, Any]]:
    iterator = {
        "artist": iter_local_artist_sources,
        "album": iter_local_album_sources,
        "track": iter_local_track_sources,
    }[entity_type](batch_size=max(1, batch_size), after_id=after_id)
    return list(islice(iterator, max(1, batch_size)))


def _new_batch_result(mode: str, source_rows_seen: int) -> dict[str, Any]:
    return {
        "mode": mode,
        "source_rows_seen": source_rows_seen,
        "sources_upserted": 0,
        "canonical_created": 0,
        "canonical_updated": 0,
    }


def _complete_batch_result(
    result: dict[str, Any],
    entity_type: str,
    after_id: int,
    sources: list[dict[str, Any]],
    batch_size: int,
) -> dict[str, Any]:
    result["sources_upserted"] = (
        result["canonical_created"] + result["canonical_updated"]
    )
    next_cursor = _next_reconciliation_cursor(
        entity_type, after_id, sources, batch_size
    )
    result["completed"] = next_cursor is None
    result["next_cursor"] = next_cursor
    return result


def _next_reconciliation_cursor(
    entity_type: str,
    after_id: int,
    sources: list[dict[str, Any]],
    batch_size: int,
) -> dict[str, Any] | None:
    if len(sources) >= max(1, batch_size):
        source = sources[-1]
        source_id = source.get("local_id") or source.get("source_cursor_id")
        if source_id is None:
            raise ValueError("Reconciliation source is missing a cursor id")
        return {"entity_type": entity_type, "after_id": int(source_id)}

    entity_index = _RECONCILIATION_ENTITY_TYPES.index(entity_type)
    if entity_index + 1 == len(_RECONCILIATION_ENTITY_TYPES):
        return None
    return {
        "entity_type": _RECONCILIATION_ENTITY_TYPES[entity_index + 1],
        "after_id": 0,
    }


def _merge_batch_result(result: dict[str, Any], batch: dict[str, Any]) -> None:
    for key in (
        "source_rows_seen",
        "sources_upserted",
        "canonical_created",
        "canonical_updated",
    ):
        result[key] += int(batch[key])


def _reconcile_local_batch_sources(
    sources: list[dict[str, Any]],
    result: dict[str, Any],
    *,
    recompute_matches: bool = False,
) -> None:
    with transaction_scope() as session:
        for source in sources:
            entity_type = source["entity_type"]
            if entity_type == "artist":
                global_uid, score = _resolve_artist_target(
                    session,
                    source,
                    recompute_matches=recompute_matches,
                )
                source = _with_match(source, score)
                existed = _canonical_exists(
                    session,
                    "global_catalog_artists",
                    "global_artist_uid",
                    global_uid,
                )
                source_id = _rebind_source_before_canonical_upsert(
                    session,
                    source,
                    global_uid,
                    preferred=True,
                    target_exists=existed,
                )
                _upsert_artist(session, source, global_uid)
            elif entity_type == "album":
                artist_uid = _find_artist_uid(
                    session, source["source_payload"]["artist_name"]
                )
                if artist_uid is None:
                    continue
                global_uid, score = _resolve_album_target(
                    session,
                    source,
                    artist_uid,
                    recompute_matches=recompute_matches,
                )
                source = _with_match(source, score)
                existed = _canonical_exists(
                    session,
                    "global_catalog_albums",
                    "global_album_uid",
                    global_uid,
                )
                source_id = _rebind_source_before_canonical_upsert(
                    session,
                    source,
                    global_uid,
                    preferred=True,
                    target_exists=existed,
                )
                _upsert_album(session, source, global_uid, artist_uid)
            else:
                payload = source["source_payload"]
                album_uid = _find_album_uid(
                    session,
                    artist_name=payload["artist_name"],
                    album_name=payload.get("album_name"),
                    local_album_id=payload.get("local_album_id"),
                )
                artist_uid = _find_local_track_artist_uid(
                    session,
                    album_uid=album_uid,
                    track_artist_name=payload["artist_name"],
                )
                if artist_uid is None:
                    continue
                global_uid, score = _resolve_track_target(
                    session,
                    source,
                    artist_uid,
                    recompute_matches=recompute_matches,
                )
                source = _with_match(source, score)
                existed = _canonical_exists(
                    session,
                    "global_catalog_tracks",
                    "global_track_uid",
                    global_uid,
                )
                source_id = _rebind_source_before_canonical_upsert(
                    session,
                    source,
                    global_uid,
                    preferred=True,
                    target_exists=existed,
                )
                _upsert_track(session, source, global_uid, artist_uid, album_uid)
            if source_id is None:
                source_id = _upsert_source(
                    session,
                    source,
                    global_uid,
                    preferred=True,
                )
            _project_source_genres(session, source, global_uid, source_id)
            _refresh_source_count(session, entity_type, global_uid)
            _count_result(result, existed)


def _reconcile_remote_batch_sources(
    sources: list[dict[str, Any]],
    result: dict[str, Any],
    *,
    recompute_matches: bool = False,
) -> None:
    with transaction_scope() as session:
        for source in sources:
            entity_type = source["entity_type"]
            if entity_type == "artist":
                target_uid, score = _resolve_artist_target(
                    session,
                    source,
                    recompute_matches=recompute_matches,
                )
                source = _with_match(source, score)
                existed = _canonical_exists(
                    session, "global_catalog_artists", "global_artist_uid", target_uid
                )
                preferred = not _canonical_has_local(session, "artist", target_uid)
                source_id = _rebind_source_before_canonical_upsert(
                    session,
                    source,
                    target_uid,
                    preferred=preferred,
                    target_exists=existed,
                )
                _upsert_remote_artist(session, source, target_uid)
                refresh_artist_photo = True
            elif entity_type == "album":
                artist_uid = _find_artist_uid(
                    session, source["source_payload"]["artist_name"]
                )
                if artist_uid is None:
                    continue
                target_uid, score = _resolve_album_target(
                    session,
                    source,
                    artist_uid,
                    recompute_matches=recompute_matches,
                )
                source = _with_match(source, score)
                existed = _canonical_exists(
                    session, "global_catalog_albums", "global_album_uid", target_uid
                )
                preferred = not _canonical_has_local(session, "album", target_uid)
                source_id = _rebind_source_before_canonical_upsert(
                    session,
                    source,
                    target_uid,
                    preferred=preferred,
                    target_exists=existed,
                )
                _upsert_remote_album(session, source, target_uid, artist_uid)
                refresh_artist_photo = False
            else:
                payload = source["source_payload"]
                artist_uid = _find_artist_uid(session, payload["artist_name"])
                if artist_uid is None:
                    continue
                album_uid = _find_album_uid(
                    session,
                    artist_name=payload["artist_name"],
                    album_name=payload.get("album_name"),
                )
                target_uid, score = _resolve_track_target(
                    session,
                    source,
                    artist_uid,
                    recompute_matches=recompute_matches,
                )
                source = _with_match(source, score)
                existed = _canonical_exists(
                    session, "global_catalog_tracks", "global_track_uid", target_uid
                )
                preferred = not _canonical_has_local(session, "track", target_uid)
                source_id = _rebind_source_before_canonical_upsert(
                    session,
                    source,
                    target_uid,
                    preferred=preferred,
                    target_exists=existed,
                )
                _upsert_remote_track(session, source, target_uid, artist_uid, album_uid)
                refresh_artist_photo = False
            if source_id is None:
                source_id = _upsert_source(
                    session,
                    source,
                    target_uid,
                    preferred=preferred,
                )
            _project_source_genres(session, source, target_uid, source_id)
            if refresh_artist_photo:
                _refresh_artist_has_photo(session, target_uid)
            _refresh_source_count(session, entity_type, target_uid)
            _count_result(result, existed)


def _insert_run(session, *, run_id: str, mode: str, started_at: datetime) -> None:
    session.execute(
        text(
            """
            INSERT INTO global_catalog_reconciliation_runs
                (run_id, mode, status, started_at)
            VALUES
                (:run_id, :mode, 'running', :started_at)
            """
        ),
        {"run_id": run_id, "mode": mode, "started_at": started_at},
    )


def begin_global_catalog_reconciliation_run(*, mode: str) -> str:
    run_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc)
    with transaction_scope() as session:
        _insert_run(session, run_id=run_id, mode=mode, started_at=started_at)
    _emit_reconcile_event("started", run_id=run_id, mode=mode)
    return run_id


def record_global_catalog_reconciliation_batch(
    run_id: str, result: Mapping[str, Any]
) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE global_catalog_reconciliation_runs
                SET
                    source_rows_seen = source_rows_seen + :source_rows_seen,
                    sources_upserted = sources_upserted + :sources_upserted,
                    canonical_created = canonical_created + :canonical_created,
                    canonical_updated = canonical_updated + :canonical_updated,
                    auto_merged = auto_merged + :auto_merged,
                    ambiguous_candidates =
                        ambiguous_candidates + :ambiguous_candidates
                WHERE run_id = :run_id
                  AND status = 'running'
                """
            ),
            {
                "run_id": run_id,
                "source_rows_seen": int(result.get("source_rows_seen") or 0),
                "sources_upserted": int(result.get("sources_upserted") or 0),
                "canonical_created": int(result.get("canonical_created") or 0),
                "canonical_updated": int(result.get("canonical_updated") or 0),
                "auto_merged": int(result.get("auto_merged") or 0),
                "ambiguous_candidates": int(result.get("ambiguous_candidates") or 0),
            },
        )


def complete_global_catalog_reconciliation_run(run_id: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE global_catalog_reconciliation_runs
                SET
                    status = 'completed',
                    completed_at = :completed_at
                WHERE run_id = :run_id
                  AND status = 'running'
                """
            ),
            {
                "run_id": run_id,
                "completed_at": datetime.now(timezone.utc),
            },
        )
        _emit_reconcile_event(
            "completed",
            run_id=run_id,
            mode="full",
            session=session,
        )


def fail_global_catalog_reconciliation_run(run_id: str, error: str) -> None:
    with transaction_scope() as session:
        _fail_run(session, run_id=run_id, error=error)
        _emit_reconcile_event(
            "failed",
            run_id=run_id,
            mode="full",
            error=error,
            session=session,
        )


def _complete_run(session, *, run_id: str, result: dict[str, Any]) -> None:
    session.execute(
        text(
            """
            UPDATE global_catalog_reconciliation_runs
            SET
                status = 'completed',
                completed_at = :completed_at,
                source_rows_seen = :source_rows_seen,
                sources_upserted = :sources_upserted,
                canonical_created = :canonical_created,
                canonical_updated = :canonical_updated
            WHERE run_id = :run_id
            """
        ),
        {
            "run_id": run_id,
            "completed_at": datetime.now(timezone.utc),
            "source_rows_seen": result["source_rows_seen"],
            "sources_upserted": result["sources_upserted"],
            "canonical_created": result["canonical_created"],
            "canonical_updated": result["canonical_updated"],
        },
    )


def _fail_run(session, *, run_id: str, error: str) -> None:
    session.execute(
        text(
            """
            UPDATE global_catalog_reconciliation_runs
            SET
                status = 'failed',
                completed_at = :completed_at,
                error = :error
            WHERE run_id = :run_id
            """
        ),
        {
            "run_id": run_id,
            "completed_at": datetime.now(timezone.utc),
            "error": error[:4000],
        },
    )


def _emit_reconcile_event(
    status: str,
    *,
    run_id: str | None = None,
    mode: str | None = None,
    node_uid: str | None = None,
    result: dict[str, Any] | None = None,
    error: str | None = None,
    session=None,
) -> None:
    payload = dict(result or {})
    if run_id is not None:
        payload.setdefault("run_id", run_id)
    if mode is not None:
        payload.setdefault("mode", mode)
    if node_uid is not None:
        payload["node_uid"] = node_uid
    if error is not None:
        payload["error"] = error
    append_domain_event(
        f"global_catalog.reconcile.{status}",
        payload,
        scope="global_catalog",
        subject_key=str(payload.get("run_id") or ""),
        session=session,
    )


def _global_uid(source: dict[str, Any]) -> str:
    source_key = (
        source.get("local_entity_uid")
        or source.get("local_id")
        or source.get("remote_entity_uid")
    )
    return str(
        uuid.uuid5(
            _GLOBAL_UID_NAMESPACE,
            f"{source['entity_type']}:{source['source_kind']}:{source_key}",
        )
    )


def _canonical_exists(
    session, table_name: str, id_column: str, global_uid: str
) -> bool:
    row = session.execute(
        text(f"SELECT 1 FROM {table_name} WHERE {id_column} = :global_uid"),
        {"global_uid": global_uid},
    ).first()
    return row is not None


def _count_result(result: dict[str, Any], existed: bool) -> None:
    if existed:
        result["canonical_updated"] += 1
    else:
        result["canonical_created"] += 1


def _resolve_artist_target(
    session,
    source: dict[str, Any],
    *,
    recompute_matches: bool = False,
) -> tuple[str, MatchScore]:
    forced_target = force_merge_target_for_source(session, source)
    if forced_target:
        return forced_target, MatchScore(1.0, "manual_force_merge", auto_merge=True)

    payload = source["source_payload"]
    existing_target = _existing_source_target(session, source)
    identity_target = _canonical_identity_target(session, "artist", payload)
    if identity_target and identity_target[0] != existing_target:
        return identity_target[0], MatchScore(
            1.0,
            identity_target[1],
            auto_merge=True,
        )

    existing_target_allowed = bool(
        existing_target
        and not merge_blocked_for_source(session, source, existing_target)
    )
    if existing_target and existing_target_allowed:
        if not recompute_matches:
            return existing_target, _existing_source_score(source)
        revalidated = _revalidate_existing_target(
            session,
            source,
            existing_target,
            score_artist_match,
        )
        if revalidated is not None:
            return revalidated

    rows = _candidate_artists(session, payload)
    existing_identity_match = (
        recompute_matches
        and existing_target is not None
        and existing_target_allowed
        and any(
            row["global_artist_uid"] == existing_target
            and _has_strong_identity_match("artist", payload, row)
            for row in rows
        )
    )
    if recompute_matches and existing_target:
        rows = [row for row in rows if row["global_artist_uid"] != existing_target]
    best_uid, best_score = _best_match(
        rows,
        payload,
        score_artist_match,
        uid_key="global_artist_uid",
    )
    if best_uid and best_score.auto_merge:
        if merge_blocked_for_source(session, source, best_uid):
            return _global_uid(source), MatchScore(
                best_score.confidence,
                "manual_force_split",
                candidate=True,
            )
        return best_uid, best_score
    if existing_identity_match and existing_target is not None:
        return existing_target, MatchScore(
            1.0,
            "existing_strong_identity",
            auto_merge=True,
        )
    return _global_uid(source), MatchScore(0.0, "new_remote_artist")


def _resolve_album_target(
    session,
    source: dict[str, Any],
    artist_uid: str,
    *,
    recompute_matches: bool = False,
) -> tuple[str, MatchScore]:
    forced_target = force_merge_target_for_source(session, source)
    if forced_target:
        return forced_target, MatchScore(1.0, "manual_force_merge", auto_merge=True)

    payload = source["source_payload"]
    provenance_target = str(payload.get("imported_global_album_uid") or "")
    if provenance_target and not merge_blocked_for_source(
        session,
        source,
        provenance_target,
    ):
        return provenance_target, MatchScore(
            1.0,
            "federation_import_provenance",
            auto_merge=True,
        )

    existing_target = _existing_source_target(session, source)
    identity_target = _canonical_identity_target(session, "album", payload)
    if identity_target and identity_target[0] != existing_target:
        return identity_target[0], MatchScore(
            1.0,
            identity_target[1],
            auto_merge=True,
        )

    existing_target_allowed = bool(
        existing_target
        and not merge_blocked_for_source(session, source, existing_target)
    )
    if existing_target and existing_target_allowed:
        if not recompute_matches:
            return existing_target, _existing_source_score(source)
        revalidated = _revalidate_existing_target(
            session,
            source,
            existing_target,
            score_album_match,
        )
        if revalidated is not None:
            return revalidated

    rows = _candidate_albums(session, payload, artist_uid)
    existing_identity_match = (
        recompute_matches
        and existing_target is not None
        and existing_target_allowed
        and any(
            row["global_album_uid"] == existing_target
            and _has_strong_identity_match("album", payload, row)
            for row in rows
        )
    )
    if recompute_matches and existing_target:
        rows = [row for row in rows if row["global_album_uid"] != existing_target]
    best_uid, best_score = _best_match(
        rows,
        payload,
        score_album_match,
        uid_key="global_album_uid",
    )
    if best_uid and best_score.auto_merge:
        if merge_blocked_for_source(session, source, best_uid):
            return _global_uid(source), MatchScore(
                best_score.confidence,
                "manual_force_split",
                candidate=True,
            )
        return best_uid, best_score
    if existing_identity_match and existing_target is not None:
        return existing_target, MatchScore(
            1.0,
            "existing_strong_identity",
            auto_merge=True,
        )
    return _global_uid(source), best_score or MatchScore(0.0, "new_remote_album")


def _resolve_track_target(
    session,
    source: dict[str, Any],
    artist_uid: str,
    *,
    recompute_matches: bool = False,
) -> tuple[str, MatchScore]:
    forced_target = force_merge_target_for_source(session, source)
    if forced_target:
        return forced_target, MatchScore(1.0, "manual_force_merge", auto_merge=True)

    payload = source["source_payload"]
    existing_target = _existing_source_target(session, source)
    identity_target = _canonical_identity_target(session, "track", payload)
    if identity_target and identity_target[0] != existing_target:
        return identity_target[0], MatchScore(
            1.0,
            identity_target[1],
            auto_merge=True,
        )

    existing_target_allowed = bool(
        existing_target
        and not merge_blocked_for_source(session, source, existing_target)
    )
    if existing_target and existing_target_allowed:
        if not recompute_matches:
            return existing_target, _existing_source_score(source)
        revalidated = _revalidate_existing_target(
            session,
            source,
            existing_target,
            score_track_match,
        )
        if revalidated is not None:
            return revalidated

    rows = _candidate_tracks(session, payload, artist_uid)
    existing_identity_match = (
        recompute_matches
        and existing_target is not None
        and existing_target_allowed
        and any(
            row["global_track_uid"] == existing_target
            and _has_strong_identity_match("track", payload, row)
            for row in rows
        )
    )
    if recompute_matches and existing_target:
        rows = [row for row in rows if row["global_track_uid"] != existing_target]
    best_uid, best_score = _best_match(
        rows,
        payload,
        score_track_match,
        uid_key="global_track_uid",
    )
    if best_uid and best_score.auto_merge:
        if merge_blocked_for_source(session, source, best_uid):
            return _global_uid(source), MatchScore(
                best_score.confidence,
                "manual_force_split",
                candidate=True,
            )
        return best_uid, best_score
    if existing_identity_match and existing_target is not None:
        return existing_target, MatchScore(
            1.0,
            "existing_strong_identity",
            auto_merge=True,
        )
    return _global_uid(source), best_score or MatchScore(0.0, "new_remote_track")


def _revalidate_existing_target(
    session,
    source: dict[str, Any],
    existing_target: str,
    scorer,
) -> tuple[str, MatchScore] | None:
    if _global_uid(source) == existing_target:
        return existing_target, MatchScore(
            1.0,
            "existing_source_identity",
            auto_merge=True,
        )

    rows = (
        session.execute(
            text(
                """
                SELECT
                    source_kind,
                    node_uid::text AS node_uid,
                    remote_entity_uid,
                    local_id,
                    local_entity_uid::text AS local_entity_uid,
                    source_payload_json
                FROM global_catalog_sources
                WHERE entity_type = :entity_type
                  AND global_entity_uid = CAST(:global_entity_uid AS uuid)
                  AND source_deleted_at IS NULL
                  AND NOT source_stale
                """
            ),
            {
                "entity_type": source["entity_type"],
                "global_entity_uid": existing_target,
            },
        )
        .mappings()
        .all()
    )
    anchor = next(
        (
            row
            for row in rows
            if _global_uid(
                {
                    "entity_type": source["entity_type"],
                    "source_kind": row["source_kind"],
                    "local_id": row["local_id"],
                    "local_entity_uid": row["local_entity_uid"],
                    "remote_entity_uid": row["remote_entity_uid"],
                }
            )
            == existing_target
        ),
        None,
    )
    if anchor is None:
        return None
    payload = anchor.get("source_payload_json")
    if isinstance(payload, str):
        payload = json.loads(payload)
    if isinstance(payload, dict):
        score = scorer(source["source_payload"], payload)
        if score.auto_merge:
            return existing_target, score
    return None


def _best_match(
    rows: list[dict[str, Any]],
    payload: dict[str, Any],
    scorer,
    *,
    uid_key: str,
) -> tuple[str | None, MatchScore]:
    best_uid: str | None = None
    best_score = MatchScore(0.0, "no_match")
    for row in rows:
        score = scorer(payload, row)
        if score.confidence > best_score.confidence:
            best_uid = row[uid_key]
            best_score = score
    return best_uid, best_score


def _has_strong_identity_match(
    entity_type: str,
    payload: dict[str, Any],
    candidate: dict[str, Any],
) -> bool:
    identifiers = {
        "artist": ("musicbrainz_artist_mbid",),
        "album": (
            "musicbrainz_release_mbid",
            "musicbrainz_release_group_mbid",
            "upc",
        ),
        "track": ("musicbrainz_recording_mbid", "isrc"),
    }[entity_type]
    return any(
        payload.get(identifier) and payload.get(identifier) == candidate.get(identifier)
        for identifier in identifiers
    )


def _canonical_identity_target(
    session,
    entity_type: str,
    payload: dict[str, Any],
) -> tuple[str, str] | None:
    if entity_type == "artist":
        identifier = payload.get("musicbrainz_artist_mbid")
        if not identifier:
            return None
        target = session.execute(
            text(
                """
                SELECT global_artist_uid::text
                FROM global_catalog_artists
                WHERE musicbrainz_artist_mbid = :identifier
                """
            ),
            {"identifier": identifier},
        ).scalar_one_or_none()
        method = "musicbrainz_artist_mbid"
    elif entity_type == "album":
        identifier = payload.get("musicbrainz_release_mbid")
        if not identifier:
            return None
        target = session.execute(
            text(
                """
                SELECT global_album_uid::text
                FROM global_catalog_albums
                WHERE musicbrainz_release_mbid = :identifier
                """
            ),
            {"identifier": identifier},
        ).scalar_one_or_none()
        method = "musicbrainz_release_mbid"
    else:
        identifier = payload.get("musicbrainz_recording_mbid")
        if not identifier:
            return None
        target = session.execute(
            text(
                """
                SELECT global_track_uid::text
                FROM global_catalog_tracks
                WHERE musicbrainz_recording_mbid = :identifier
                """
            ),
            {"identifier": identifier},
        ).scalar_one_or_none()
        method = "musicbrainz_recording_mbid"

    if target is None:
        return None
    return str(target), method


def _existing_source_target(session, source: dict[str, Any]) -> str | None:
    if source["source_kind"] == "federated":
        row = (
            session.execute(
                text(
                    """
                SELECT global_entity_uid::text AS global_entity_uid
                FROM global_catalog_sources
                WHERE entity_type = :entity_type
                  AND source_kind = 'federated'
                  AND node_uid = CAST(:node_uid AS uuid)
                  AND remote_entity_uid = :remote_entity_uid
                LIMIT 1
                """
                ),
                {
                    "entity_type": source["entity_type"],
                    "node_uid": source["node_uid"],
                    "remote_entity_uid": source["remote_entity_uid"],
                },
            )
            .mappings()
            .first()
        )
    elif source.get("local_entity_uid"):
        row = (
            session.execute(
                text(
                    """
                SELECT global_entity_uid::text AS global_entity_uid
                FROM global_catalog_sources
                WHERE entity_type = :entity_type
                  AND source_kind = 'local'
                  AND local_entity_uid = CAST(:local_entity_uid AS uuid)
                LIMIT 1
                """
                ),
                {
                    "entity_type": source["entity_type"],
                    "local_entity_uid": source["local_entity_uid"],
                },
            )
            .mappings()
            .first()
        )
    else:
        row = (
            session.execute(
                text(
                    """
                SELECT global_entity_uid::text AS global_entity_uid
                FROM global_catalog_sources
                WHERE entity_type = :entity_type
                  AND source_kind = 'local'
                  AND local_id = :local_id
                LIMIT 1
                """
                ),
                {
                    "entity_type": source["entity_type"],
                    "local_id": source["local_id"],
                },
            )
            .mappings()
            .first()
        )
    return str(row["global_entity_uid"]) if row else None


def _existing_source_score(source: dict[str, Any]) -> MatchScore:
    try:
        confidence = float(source.get("match_confidence") or 1.0)
    except (TypeError, ValueError):
        confidence = 1.0
    return MatchScore(
        confidence,
        str(source.get("match_method") or "existing_source_identity"),
        auto_merge=True,
    )


def _candidate_artists(session, payload: dict[str, Any]) -> list[dict[str, Any]]:
    row_mbid = payload.get("musicbrainz_artist_mbid")
    rows = (
        session.execute(
            text(
                """
                SELECT
                    global_artist_uid::text AS global_artist_uid,
                    canonical_name,
                    musicbrainz_artist_mbid
                FROM global_catalog_artists
                WHERE normalized_name = :normalized_name
                   OR (
                        :musicbrainz_artist_mbid IS NOT NULL
                        AND musicbrainz_artist_mbid = :musicbrainz_artist_mbid
                   )
                """
            ),
            {
                "normalized_name": payload["normalized_name"],
                "musicbrainz_artist_mbid": row_mbid,
            },
        )
        .mappings()
        .all()
    )
    return [dict(row) for row in rows]


def _candidate_albums(
    session, payload: dict[str, Any], artist_uid: str
) -> list[dict[str, Any]]:
    rows = (
        session.execute(
            text(
                """
                SELECT
                    global_album_uid::text AS global_album_uid,
                    canonical_name,
                    artist_name,
                    year,
                    track_count,
                    musicbrainz_release_group_mbid,
                    musicbrainz_release_mbid,
                    upc
                FROM global_catalog_albums
                WHERE global_artist_uid = :artist_uid
                  AND (
                    normalized_name = :normalized_name
                    OR (
                        :musicbrainz_release_mbid IS NOT NULL
                        AND musicbrainz_release_mbid = :musicbrainz_release_mbid
                    )
                    OR (
                        :musicbrainz_release_group_mbid IS NOT NULL
                        AND musicbrainz_release_group_mbid = :musicbrainz_release_group_mbid
                    )
                    OR (:upc IS NOT NULL AND upc = :upc)
                  )
                """
            ),
            {
                "artist_uid": artist_uid,
                "normalized_name": payload["normalized_name"],
                "musicbrainz_release_mbid": payload.get("musicbrainz_release_mbid"),
                "musicbrainz_release_group_mbid": payload.get(
                    "musicbrainz_release_group_mbid"
                ),
                "upc": payload.get("upc"),
            },
        )
        .mappings()
        .all()
    )
    return [dict(row) for row in rows]


def _candidate_tracks(
    session, payload: dict[str, Any], artist_uid: str
) -> list[dict[str, Any]]:
    rows = (
        session.execute(
            text(
                """
                SELECT
                    global_track_uid::text AS global_track_uid,
                    canonical_title,
                    artist_name,
                    album_name,
                    disc_number,
                    track_number,
                    duration_seconds,
                    musicbrainz_recording_mbid,
                    isrc
                FROM global_catalog_tracks
                WHERE global_artist_uid = :artist_uid
                  AND (
                    normalized_title = :normalized_title
                    OR (
                        :musicbrainz_recording_mbid IS NOT NULL
                        AND musicbrainz_recording_mbid = :musicbrainz_recording_mbid
                    )
                    OR (:isrc IS NOT NULL AND isrc = :isrc)
                  )
                """
            ),
            {
                "artist_uid": artist_uid,
                "normalized_title": payload["normalized_title"],
                "musicbrainz_recording_mbid": payload.get("musicbrainz_recording_mbid"),
                "isrc": payload.get("isrc"),
            },
        )
        .mappings()
        .all()
    )
    return [dict(row) for row in rows]


def _with_match(source: dict[str, Any], score: MatchScore) -> dict[str, Any]:
    updated = dict(source)
    updated["match_confidence"] = score.confidence
    updated["match_method"] = score.method
    return updated


def _upsert_artist(session, source: dict[str, Any], global_uid: str) -> None:
    payload = source["source_payload"]
    session.execute(
        text(
            """
            INSERT INTO global_catalog_artists
                (
                    global_artist_uid,
                    canonical_name,
                    public_slug,
                    sort_name,
                    normalized_name,
                    musicbrainz_artist_mbid,
                    local_artist_id,
                    local_artist_entity_uid,
                    display_source_json,
                    availability_json,
                    match_json,
                    source_count,
                    has_local,
                    has_remote,
                    has_photo,
                    search_vector,
                    updated_at
                )
            VALUES
                (
                    :global_uid,
                    :canonical_name,
                    :public_slug,
                    :sort_name,
                    :normalized_name,
                    :musicbrainz_artist_mbid,
                    :local_id,
                    :local_entity_uid,
                    :display_source_json,
                    :availability_json,
                    :match_json,
                    1,
                    true,
                    false,
                    :has_photo,
                    to_tsvector('simple', :search_text),
                    NOW()
                )
            ON CONFLICT (global_artist_uid) DO UPDATE SET
                canonical_name = CASE
                    WHEN global_catalog_artists.local_artist_id IS NULL
                      OR EXCLUDED.local_artist_id <= global_catalog_artists.local_artist_id
                    THEN EXCLUDED.canonical_name
                    ELSE global_catalog_artists.canonical_name
                END,
                public_slug = CASE
                    WHEN global_catalog_artists.local_artist_id IS NULL
                      OR EXCLUDED.local_artist_id <= global_catalog_artists.local_artist_id
                    THEN EXCLUDED.public_slug
                    ELSE global_catalog_artists.public_slug
                END,
                sort_name = CASE
                    WHEN global_catalog_artists.local_artist_id IS NULL
                      OR EXCLUDED.local_artist_id <= global_catalog_artists.local_artist_id
                    THEN EXCLUDED.sort_name
                    ELSE global_catalog_artists.sort_name
                END,
                normalized_name = CASE
                    WHEN global_catalog_artists.local_artist_id IS NULL
                      OR EXCLUDED.local_artist_id <= global_catalog_artists.local_artist_id
                    THEN EXCLUDED.normalized_name
                    ELSE global_catalog_artists.normalized_name
                END,
                musicbrainz_artist_mbid = CASE
                    WHEN global_catalog_artists.local_artist_id IS NULL
                      OR EXCLUDED.local_artist_id <= global_catalog_artists.local_artist_id
                    THEN EXCLUDED.musicbrainz_artist_mbid
                    ELSE global_catalog_artists.musicbrainz_artist_mbid
                END,
                local_artist_id = CASE
                    WHEN global_catalog_artists.local_artist_id IS NULL
                      OR EXCLUDED.local_artist_id <= global_catalog_artists.local_artist_id
                    THEN EXCLUDED.local_artist_id
                    ELSE global_catalog_artists.local_artist_id
                END,
                local_artist_entity_uid = CASE
                    WHEN global_catalog_artists.local_artist_id IS NULL
                      OR EXCLUDED.local_artist_id <= global_catalog_artists.local_artist_id
                    THEN EXCLUDED.local_artist_entity_uid
                    ELSE global_catalog_artists.local_artist_entity_uid
                END,
                display_source_json = CASE
                    WHEN global_catalog_artists.local_artist_id IS NULL
                      OR EXCLUDED.local_artist_id <= global_catalog_artists.local_artist_id
                    THEN EXCLUDED.display_source_json
                    ELSE global_catalog_artists.display_source_json
                END,
                availability_json = EXCLUDED.availability_json,
                match_json = CASE
                    WHEN global_catalog_artists.local_artist_id IS NULL
                      OR EXCLUDED.local_artist_id <= global_catalog_artists.local_artist_id
                    THEN EXCLUDED.match_json
                    ELSE global_catalog_artists.match_json
                END,
                source_count = EXCLUDED.source_count,
                has_local = true,
                has_photo = global_catalog_artists.has_photo OR EXCLUDED.has_photo,
                search_vector = CASE
                    WHEN global_catalog_artists.local_artist_id IS NULL
                      OR EXCLUDED.local_artist_id <= global_catalog_artists.local_artist_id
                    THEN EXCLUDED.search_vector
                    ELSE global_catalog_artists.search_vector
                END,
                updated_at = NOW()
            """
        ),
        {
            "global_uid": global_uid,
            "canonical_name": payload["canonical_name"],
            "public_slug": build_artist_slug(payload["canonical_name"]),
            "sort_name": payload["sort_name"],
            "normalized_name": payload["normalized_name"],
            "musicbrainz_artist_mbid": payload["musicbrainz_artist_mbid"],
            "local_id": source["local_id"],
            "local_entity_uid": source["local_entity_uid"],
            "display_source_json": _json(_source_ref(source)),
            "availability_json": _json({"local": True, "remote": False}),
            "match_json": _json(_match_ref(source)),
            "has_photo": payload["has_photo"],
            "search_text": payload["canonical_name"],
        },
    )
    canonical_name = session.execute(
        text(
            """
            SELECT canonical_name
            FROM global_catalog_artists
            WHERE global_artist_uid = CAST(:global_uid AS uuid)
            """
        ),
        {"global_uid": global_uid},
    ).scalar_one()
    claim_artist_public_slug(session, global_uid, build_artist_slug(canonical_name))


def _upsert_album(
    session,
    source: dict[str, Any],
    global_uid: str,
    artist_uid: str,
) -> None:
    payload = source["source_payload"]
    session.execute(
        text(
            """
            INSERT INTO global_catalog_albums
                (
                    global_album_uid,
                    global_artist_uid,
                    canonical_name,
                    normalized_name,
                    artist_name,
                    artist_slug,
                    public_slug,
                    year,
                    release_date,
                    track_count,
                    total_duration_seconds,
                    musicbrainz_release_group_mbid,
                    musicbrainz_release_mbid,
                    release_group_primary_type,
                    release_group_secondary_types,
                    local_album_id,
                    local_album_entity_uid,
                    display_source_json,
                    artwork_source_json,
                    availability_json,
                    match_json,
                    source_count,
                    has_local,
                    has_remote,
                    has_cover,
                    search_vector,
                    updated_at
                )
            VALUES
                (
                    :global_uid,
                    :artist_uid,
                    :canonical_name,
                    :normalized_name,
                    :artist_name,
                    :artist_slug,
                    :public_slug,
                    :year,
                    :release_date,
                    :track_count,
                    :total_duration_seconds,
                    :musicbrainz_release_group_mbid,
                    :musicbrainz_release_mbid,
                    :release_group_primary_type,
                    CAST(:release_group_secondary_types AS jsonb),
                    :local_id,
                    :local_entity_uid,
                    :display_source_json,
                    :artwork_source_json,
                    :availability_json,
                    :match_json,
                    1,
                    true,
                    false,
                    :has_cover,
                    to_tsvector('simple', :search_text),
                    NOW()
                )
            ON CONFLICT (global_album_uid) DO UPDATE SET
                global_artist_uid = EXCLUDED.global_artist_uid,
                canonical_name = EXCLUDED.canonical_name,
                normalized_name = EXCLUDED.normalized_name,
                artist_name = EXCLUDED.artist_name,
                artist_slug = EXCLUDED.artist_slug,
                public_slug = EXCLUDED.public_slug,
                year = EXCLUDED.year,
                release_date = COALESCE(
                    NULLIF(EXCLUDED.release_date, ''),
                    global_catalog_albums.release_date
                ),
                track_count = EXCLUDED.track_count,
                total_duration_seconds = EXCLUDED.total_duration_seconds,
                musicbrainz_release_group_mbid = EXCLUDED.musicbrainz_release_group_mbid,
                musicbrainz_release_mbid = EXCLUDED.musicbrainz_release_mbid,
                release_group_primary_type = COALESCE(
                    EXCLUDED.release_group_primary_type,
                    global_catalog_albums.release_group_primary_type
                ),
                release_group_secondary_types = CASE
                    WHEN EXCLUDED.release_group_secondary_types <> '[]'::jsonb
                    THEN EXCLUDED.release_group_secondary_types
                    ELSE global_catalog_albums.release_group_secondary_types
                END,
                local_album_id = EXCLUDED.local_album_id,
                local_album_entity_uid = EXCLUDED.local_album_entity_uid,
                display_source_json = EXCLUDED.display_source_json,
                artwork_source_json = EXCLUDED.artwork_source_json,
                availability_json = EXCLUDED.availability_json,
                match_json = EXCLUDED.match_json,
                source_count = EXCLUDED.source_count,
                has_local = true,
                has_cover = EXCLUDED.has_cover,
                search_vector = EXCLUDED.search_vector,
                updated_at = NOW()
            """
        ),
        {
            "global_uid": global_uid,
            "artist_uid": artist_uid,
            "canonical_name": payload["canonical_name"],
            "normalized_name": payload["normalized_name"],
            "artist_name": payload["artist_name"],
            "artist_slug": build_artist_slug(payload["artist_name"]),
            "public_slug": build_public_album_slug(payload["canonical_name"]),
            "year": payload["year"],
            "release_date": payload.get("release_date"),
            "track_count": payload["track_count"],
            "total_duration_seconds": payload["total_duration_seconds"],
            "musicbrainz_release_group_mbid": payload["musicbrainz_release_group_mbid"],
            "musicbrainz_release_mbid": payload["musicbrainz_release_mbid"],
            "release_group_primary_type": payload.get("release_group_primary_type"),
            "release_group_secondary_types": _json(
                payload.get("release_group_secondary_types") or []
            ),
            "local_id": source["local_id"],
            "local_entity_uid": source["local_entity_uid"],
            "display_source_json": _json(_source_ref(source)),
            "artwork_source_json": _json(_source_ref(source)),
            "availability_json": _json({"local": True, "remote": False}),
            "match_json": _json(_match_ref(source)),
            "has_cover": payload["has_cover"],
            "search_text": f"{payload['artist_name']} {payload['canonical_name']}",
        },
    )
    claim_album_public_slug(
        session,
        global_uid,
        artist_uid,
        build_public_album_slug(payload["canonical_name"]),
        year=payload.get("year"),
    )
    session.execute(
        text(
            """
            UPDATE global_catalog_albums album
            SET artist_slug = artist.public_slug
            FROM global_catalog_artists artist
            WHERE album.global_album_uid = CAST(:album_uid AS uuid)
              AND artist.global_artist_uid = album.global_artist_uid
            """
        ),
        {"album_uid": global_uid},
    )


def _upsert_track(
    session,
    source: dict[str, Any],
    global_uid: str,
    artist_uid: str,
    album_uid: str | None,
) -> None:
    payload = source["source_payload"]
    session.execute(
        text(
            """
            INSERT INTO global_catalog_tracks
                (
                    global_track_uid,
                    global_album_uid,
                    global_artist_uid,
                    canonical_title,
                    normalized_title,
                    artist_name,
                    album_name,
                    disc_number,
                    track_number,
                    duration_seconds,
                    musicbrainz_recording_mbid,
                    local_track_id,
                    local_track_entity_uid,
                    display_source_json,
                    availability_json,
                    match_json,
                    source_count,
                    has_local,
                    has_remote,
                    search_vector,
                    updated_at
                )
            VALUES
                (
                    :global_uid,
                    :album_uid,
                    :artist_uid,
                    :canonical_title,
                    :normalized_title,
                    :artist_name,
                    :album_name,
                    :disc_number,
                    :track_number,
                    :duration_seconds,
                    :musicbrainz_recording_mbid,
                    :local_id,
                    :local_entity_uid,
                    :display_source_json,
                    :availability_json,
                    :match_json,
                    1,
                    true,
                    false,
                    to_tsvector('simple', :search_text),
                    NOW()
                )
            ON CONFLICT (global_track_uid) DO UPDATE SET
                global_album_uid = EXCLUDED.global_album_uid,
                global_artist_uid = EXCLUDED.global_artist_uid,
                canonical_title = EXCLUDED.canonical_title,
                normalized_title = EXCLUDED.normalized_title,
                artist_name = EXCLUDED.artist_name,
                album_name = EXCLUDED.album_name,
                disc_number = EXCLUDED.disc_number,
                track_number = EXCLUDED.track_number,
                duration_seconds = EXCLUDED.duration_seconds,
                musicbrainz_recording_mbid = EXCLUDED.musicbrainz_recording_mbid,
                local_track_id = EXCLUDED.local_track_id,
                local_track_entity_uid = EXCLUDED.local_track_entity_uid,
                display_source_json = EXCLUDED.display_source_json,
                availability_json = EXCLUDED.availability_json,
                match_json = EXCLUDED.match_json,
                source_count = EXCLUDED.source_count,
                has_local = true,
                search_vector = EXCLUDED.search_vector,
                updated_at = NOW()
            """
        ),
        {
            "global_uid": global_uid,
            "album_uid": album_uid,
            "artist_uid": artist_uid,
            "canonical_title": payload["canonical_title"],
            "normalized_title": payload["normalized_title"],
            "artist_name": payload["artist_name"],
            "album_name": payload["album_name"],
            "disc_number": payload["disc_number"],
            "track_number": payload["track_number"],
            "duration_seconds": payload["duration_seconds"],
            "musicbrainz_recording_mbid": payload["musicbrainz_recording_mbid"],
            "local_id": source["local_id"],
            "local_entity_uid": source["local_entity_uid"],
            "display_source_json": _json(_source_ref(source)),
            "availability_json": _json({"local": True, "remote": False}),
            "match_json": _json(_match_ref(source)),
            "search_text": (
                f"{payload['artist_name']} {payload['album_name']} "
                f"{payload['canonical_title']}"
            ),
        },
    )


def _upsert_remote_artist(
    session,
    source: dict[str, Any],
    global_uid: str,
) -> None:
    payload = source["source_payload"]
    if _canonical_exists(
        session, "global_catalog_artists", "global_artist_uid", global_uid
    ):
        session.execute(
            text(
                """
                UPDATE global_catalog_artists
                SET has_remote = true, updated_at = NOW()
                WHERE global_artist_uid = :global_uid
                """
            ),
            {"global_uid": global_uid},
        )
        return

    session.execute(
        text(
            """
            INSERT INTO global_catalog_artists
                (
                    global_artist_uid,
                    canonical_name,
                    public_slug,
                    sort_name,
                    normalized_name,
                    musicbrainz_artist_mbid,
                    display_source_json,
                    availability_json,
                    match_json,
                    source_count,
                    has_local,
                    has_remote,
                    has_photo,
                    search_vector,
                    updated_at
                )
            VALUES
                (
                    :global_uid,
                    :canonical_name,
                    :public_slug,
                    :sort_name,
                    :normalized_name,
                    :musicbrainz_artist_mbid,
                    :display_source_json,
                    :availability_json,
                    :match_json,
                    1,
                    false,
                    true,
                    :has_photo,
                    to_tsvector('simple', :search_text),
                    NOW()
                )
            """
        ),
        {
            "global_uid": global_uid,
            "canonical_name": payload["canonical_name"],
            "public_slug": build_artist_slug(payload["canonical_name"]),
            "sort_name": payload["sort_name"],
            "normalized_name": payload["normalized_name"],
            "musicbrainz_artist_mbid": payload["musicbrainz_artist_mbid"],
            "display_source_json": _json(_source_ref(source)),
            "availability_json": _json({"local": False, "remote": True}),
            "match_json": _json(_match_ref(source)),
            "has_photo": payload["has_photo"],
            "search_text": payload["canonical_name"],
        },
    )
    claim_artist_public_slug(
        session,
        global_uid,
        build_artist_slug(payload["canonical_name"]),
    )


def _upsert_remote_album(
    session,
    source: dict[str, Any],
    global_uid: str,
    artist_uid: str,
) -> None:
    payload = source["source_payload"]
    if _canonical_exists(
        session, "global_catalog_albums", "global_album_uid", global_uid
    ):
        session.execute(
            text(
                """
                UPDATE global_catalog_albums
                SET
                    has_remote = true,
                    release_date = COALESCE(
                        NULLIF(global_catalog_albums.release_date, ''),
                        NULLIF(:release_date, '')
                    ),
                    release_group_primary_type = COALESCE(
                        release_group_primary_type,
                        :release_group_primary_type
                    ),
                    release_group_secondary_types = CASE
                        WHEN release_group_secondary_types = '[]'::jsonb
                        THEN CAST(:release_group_secondary_types AS jsonb)
                        ELSE release_group_secondary_types
                    END,
                    has_cover = global_catalog_albums.has_cover OR :has_cover,
                    artwork_source_json = CASE
                        WHEN :has_cover THEN :artwork_source_json
                        ELSE artwork_source_json
                    END,
                    updated_at = NOW()
                WHERE global_album_uid = :global_uid
                """
            ),
            {
                "global_uid": global_uid,
                "release_date": payload.get("release_date"),
                "release_group_primary_type": payload.get("release_group_primary_type"),
                "release_group_secondary_types": _json(
                    payload.get("release_group_secondary_types") or []
                ),
                "has_cover": payload["has_cover"],
                "artwork_source_json": _json(_source_ref(source)),
            },
        )
        return

    session.execute(
        text(
            """
            INSERT INTO global_catalog_albums
                (
                    global_album_uid,
                    global_artist_uid,
                    canonical_name,
                    normalized_name,
                    artist_name,
                    artist_slug,
                    public_slug,
                    year,
                    release_date,
                    track_count,
                    total_duration_seconds,
                    musicbrainz_release_group_mbid,
                    musicbrainz_release_mbid,
                    release_group_primary_type,
                    release_group_secondary_types,
                    upc,
                    display_source_json,
                    artwork_source_json,
                    availability_json,
                    match_json,
                    source_count,
                    has_local,
                    has_remote,
                    has_cover,
                    search_vector,
                    updated_at
                )
            VALUES
                (
                    :global_uid,
                    :artist_uid,
                    :canonical_name,
                    :normalized_name,
                    :artist_name,
                    :artist_slug,
                    :public_slug,
                    :year,
                    :release_date,
                    :track_count,
                    :total_duration_seconds,
                    :musicbrainz_release_group_mbid,
                    :musicbrainz_release_mbid,
                    :release_group_primary_type,
                    CAST(:release_group_secondary_types AS jsonb),
                    :upc,
                    :display_source_json,
                    :artwork_source_json,
                    :availability_json,
                    :match_json,
                    1,
                    false,
                    true,
                    :has_cover,
                    to_tsvector('simple', :search_text),
                    NOW()
                )
            """
        ),
        {
            "global_uid": global_uid,
            "artist_uid": artist_uid,
            "canonical_name": payload["canonical_name"],
            "normalized_name": payload["normalized_name"],
            "artist_name": payload["artist_name"],
            "artist_slug": build_artist_slug(payload["artist_name"]),
            "public_slug": build_public_album_slug(payload["canonical_name"]),
            "year": payload["year"],
            "release_date": payload["release_date"],
            "track_count": payload["track_count"],
            "total_duration_seconds": payload["total_duration_seconds"],
            "musicbrainz_release_group_mbid": payload["musicbrainz_release_group_mbid"],
            "musicbrainz_release_mbid": payload["musicbrainz_release_mbid"],
            "release_group_primary_type": payload.get("release_group_primary_type"),
            "release_group_secondary_types": _json(
                payload.get("release_group_secondary_types") or []
            ),
            "upc": payload["upc"],
            "display_source_json": _json(_source_ref(source)),
            "artwork_source_json": _json(_source_ref(source)),
            "availability_json": _json({"local": False, "remote": True}),
            "match_json": _json(_match_ref(source)),
            "has_cover": payload["has_cover"],
            "search_text": f"{payload['artist_name']} {payload['canonical_name']}",
        },
    )
    claim_album_public_slug(
        session,
        global_uid,
        artist_uid,
        build_public_album_slug(payload["canonical_name"]),
        year=payload.get("year"),
    )
    session.execute(
        text(
            """
            UPDATE global_catalog_albums album
            SET artist_slug = artist.public_slug
            FROM global_catalog_artists artist
            WHERE album.global_album_uid = CAST(:album_uid AS uuid)
              AND artist.global_artist_uid = album.global_artist_uid
            """
        ),
        {"album_uid": global_uid},
    )


def _upsert_remote_track(
    session,
    source: dict[str, Any],
    global_uid: str,
    artist_uid: str,
    album_uid: str | None,
) -> None:
    payload = source["source_payload"]
    if _canonical_exists(
        session, "global_catalog_tracks", "global_track_uid", global_uid
    ):
        session.execute(
            text(
                """
                UPDATE global_catalog_tracks
                SET has_remote = true, updated_at = NOW()
                WHERE global_track_uid = :global_uid
                """
            ),
            {"global_uid": global_uid},
        )
        return

    session.execute(
        text(
            """
            INSERT INTO global_catalog_tracks
                (
                    global_track_uid,
                    global_album_uid,
                    global_artist_uid,
                    canonical_title,
                    normalized_title,
                    artist_name,
                    album_name,
                    disc_number,
                    track_number,
                    duration_seconds,
                    musicbrainz_recording_mbid,
                    isrc,
                    display_source_json,
                    availability_json,
                    match_json,
                    source_count,
                    has_local,
                    has_remote,
                    search_vector,
                    updated_at
                )
            VALUES
                (
                    :global_uid,
                    :album_uid,
                    :artist_uid,
                    :canonical_title,
                    :normalized_title,
                    :artist_name,
                    :album_name,
                    :disc_number,
                    :track_number,
                    :duration_seconds,
                    :musicbrainz_recording_mbid,
                    :isrc,
                    :display_source_json,
                    :availability_json,
                    :match_json,
                    1,
                    false,
                    true,
                    to_tsvector('simple', :search_text),
                    NOW()
                )
            """
        ),
        {
            "global_uid": global_uid,
            "album_uid": album_uid,
            "artist_uid": artist_uid,
            "canonical_title": payload["canonical_title"],
            "normalized_title": payload["normalized_title"],
            "artist_name": payload["artist_name"],
            "album_name": payload["album_name"],
            "disc_number": payload["disc_number"],
            "track_number": payload["track_number"],
            "duration_seconds": payload["duration_seconds"],
            "musicbrainz_recording_mbid": payload["musicbrainz_recording_mbid"],
            "isrc": payload["isrc"],
            "display_source_json": _json(_source_ref(source)),
            "availability_json": _json({"local": False, "remote": True}),
            "match_json": _json(_match_ref(source)),
            "search_text": (
                f"{payload['artist_name']} {payload['album_name']} "
                f"{payload['canonical_title']}"
            ),
        },
    )


def _upsert_source(
    session,
    source: dict[str, Any],
    global_entity_uid: str,
    *,
    preferred: bool,
) -> int:
    conflict_target = _source_conflict_target(source)
    previous_global_uid = _existing_source_target(session, source)

    source_id = session.execute(
        text(
            f"""
            INSERT INTO global_catalog_sources
                (
                    entity_type,
                    global_entity_uid,
                    source_kind,
                    node_uid,
                    remote_entity_uid,
                    local_id,
                    local_entity_uid,
                    source_revision,
                    source_deleted_at,
                    source_stale,
                    source_payload_json,
                    match_key,
                    match_confidence,
                    match_method,
                    preferred_for_display,
                    preferred_for_artwork,
                    preferred_for_playback,
                    updated_at
                )
            VALUES
                (
                    :entity_type,
                    :global_entity_uid,
                    :source_kind,
                    :node_uid,
                    :remote_entity_uid,
                    :local_id,
                    :local_entity_uid,
                    :source_revision,
                    :source_deleted_at,
                    :source_stale,
                    :source_payload_json,
                    :match_key,
                    :match_confidence,
                    :match_method,
                    :preferred,
                    :preferred,
                    :preferred,
                    NOW()
                )
            ON CONFLICT {conflict_target} DO UPDATE SET
                global_entity_uid = EXCLUDED.global_entity_uid,
                source_revision = EXCLUDED.source_revision,
                source_deleted_at = EXCLUDED.source_deleted_at,
                source_stale = EXCLUDED.source_stale,
                source_payload_json = EXCLUDED.source_payload_json,
                match_key = EXCLUDED.match_key,
                match_confidence = EXCLUDED.match_confidence,
                match_method = EXCLUDED.match_method,
                preferred_for_display = EXCLUDED.preferred_for_display,
                preferred_for_artwork = EXCLUDED.preferred_for_artwork,
                preferred_for_playback = EXCLUDED.preferred_for_playback,
                updated_at = NOW()
            RETURNING id
            """
        ),
        {
            "entity_type": source["entity_type"],
            "global_entity_uid": global_entity_uid,
            "source_kind": source["source_kind"],
            "node_uid": source["node_uid"],
            "remote_entity_uid": source["remote_entity_uid"],
            "local_id": source["local_id"],
            "local_entity_uid": source["local_entity_uid"],
            "source_revision": source["source_revision"],
            "source_deleted_at": source["source_deleted_at"],
            "source_stale": source["source_stale"],
            "source_payload_json": _json(source["source_payload"]),
            "match_key": source["match_key"],
            "match_confidence": source["match_confidence"],
            "match_method": source["match_method"],
            "preferred": preferred,
        },
    ).scalar_one()
    if previous_global_uid and previous_global_uid != global_entity_uid:
        _cleanup_rebound_canonical(
            session,
            entity_type=source["entity_type"],
            previous_global_uid=previous_global_uid,
            target_global_uid=global_entity_uid,
        )
    return int(source_id)


def _rebind_source_before_canonical_upsert(
    session,
    source: dict[str, Any],
    global_entity_uid: str,
    *,
    preferred: bool,
    target_exists: bool,
) -> int | None:
    if not target_exists:
        return None
    previous_global_uid = _existing_source_target(session, source)
    if not previous_global_uid or previous_global_uid == global_entity_uid:
        return None
    return _upsert_source(
        session,
        source,
        global_entity_uid,
        preferred=preferred,
    )


def _cleanup_rebound_canonical(
    session,
    *,
    entity_type: str,
    previous_global_uid: str,
    target_global_uid: str,
) -> None:
    """Refresh a source's old canonical and remove it when it became orphaned."""
    _refresh_source_count(session, entity_type, previous_global_uid)

    from crate.db.jobs.global_catalog_genres import recompute_entity_genre_memberships

    recompute_entity_genre_memberships(
        session,
        entity_type=entity_type,
        global_entity_uid=previous_global_uid,
    )
    active_sources = int(
        session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM global_catalog_sources
                WHERE entity_type = :entity_type
                  AND global_entity_uid = CAST(:global_uid AS uuid)
                  AND source_deleted_at IS NULL
                  AND NOT source_stale
                """
            ),
            {"entity_type": entity_type, "global_uid": previous_global_uid},
        ).scalar_one()
    )
    if active_sources:
        return

    _reparent_orphaned_canonical_children(
        session,
        entity_type=entity_type,
        previous_global_uid=previous_global_uid,
        target_global_uid=target_global_uid,
    )
    table_name, id_column = _canonical_table(entity_type)
    session.execute(
        text(f"DELETE FROM {table_name} WHERE {id_column} = CAST(:global_uid AS uuid)"),
        {"global_uid": previous_global_uid},
    )


def _reparent_orphaned_canonical_children(
    session,
    *,
    entity_type: str,
    previous_global_uid: str,
    target_global_uid: str,
) -> None:
    if entity_type == "artist":
        target_name = session.execute(
            text(
                """
                SELECT canonical_name
                FROM global_catalog_artists
                WHERE global_artist_uid = CAST(:target_uid AS uuid)
                """
            ),
            {"target_uid": target_global_uid},
        ).scalar_one()
        artist_slug = build_artist_slug(str(target_name))
        session.execute(
            text(
                """
                UPDATE global_catalog_albums
                SET
                    global_artist_uid = CAST(:target_uid AS uuid),
                    artist_name = :target_name,
                    artist_slug = :artist_slug,
                    search_vector = to_tsvector(
                        'simple', :target_name || ' ' || canonical_name
                    ),
                    updated_at = NOW()
                WHERE global_artist_uid = CAST(:previous_uid AS uuid)
                """
            ),
            {
                "target_uid": target_global_uid,
                "previous_uid": previous_global_uid,
                "target_name": target_name,
                "artist_slug": artist_slug,
            },
        )
        session.execute(
            text(
                """
                UPDATE global_catalog_tracks
                SET
                    global_artist_uid = CAST(:target_uid AS uuid),
                    artist_name = :target_name,
                    search_vector = to_tsvector(
                        'simple',
                        :target_name || ' ' || COALESCE(album_name, '') || ' '
                            || canonical_title
                    ),
                    updated_at = NOW()
                WHERE global_artist_uid = CAST(:previous_uid AS uuid)
                """
            ),
            {
                "target_uid": target_global_uid,
                "previous_uid": previous_global_uid,
                "target_name": target_name,
            },
        )
    elif entity_type == "album":
        target_name = session.execute(
            text(
                """
                SELECT canonical_name
                FROM global_catalog_albums
                WHERE global_album_uid = CAST(:target_uid AS uuid)
                """
            ),
            {"target_uid": target_global_uid},
        ).scalar_one()
        session.execute(
            text(
                """
                UPDATE global_catalog_tracks
                SET
                    global_album_uid = CAST(:target_uid AS uuid),
                    album_name = :target_name,
                    search_vector = to_tsvector(
                        'simple',
                        artist_name || ' ' || :target_name || ' ' || canonical_title
                    ),
                    updated_at = NOW()
                WHERE global_album_uid = CAST(:previous_uid AS uuid)
                """
            ),
            {
                "target_uid": target_global_uid,
                "previous_uid": previous_global_uid,
                "target_name": target_name,
            },
        )


def _project_source_genres(
    session,
    source: dict[str, Any],
    global_entity_uid: str,
    source_id: int,
) -> None:
    from crate.db.jobs.global_catalog_genres import project_source_genre_assertions

    payload = source["source_payload"]
    project_source_genre_assertions(
        session,
        source_id=source_id,
        entity_type=source["entity_type"],
        global_entity_uid=global_entity_uid,
        source_kind=source["source_kind"],
        source_revision=source.get("source_revision"),
        assertions=payload.get("genre_assertions") or payload.get("genres") or [],
    )


def _find_artist_uid(session, artist_name: str) -> str | None:
    local_source = (
        session.execute(
            text(
                """
                SELECT source.global_entity_uid::text AS global_artist_uid
                FROM library_artists artist
                JOIN global_catalog_sources source
                  ON source.source_kind = 'local'
                 AND source.entity_type = 'artist'
                 AND source.local_id = artist.id
                 AND source.source_deleted_at IS NULL
                 AND NOT source.source_stale
                WHERE artist.name = :artist_name
                ORDER BY source.local_id
                LIMIT 1
                """
            ),
            {"artist_name": artist_name},
        )
        .mappings()
        .first()
    )
    if local_source:
        return local_source["global_artist_uid"]

    normalized_name = normalize_name(artist_name)
    row = (
        session.execute(
            text(
                """
                SELECT global_artist_uid::text AS global_artist_uid
                FROM global_catalog_artists
                WHERE normalized_name = :normalized_name
                ORDER BY has_local DESC, source_count DESC, canonical_name ASC
                LIMIT 1
                """
            ),
            {"normalized_name": normalized_name},
        )
        .mappings()
        .first()
    )
    return row["global_artist_uid"] if row else None


def _find_album_uid(
    session,
    *,
    artist_name: str,
    album_name: str | None,
    local_album_id: int | None = None,
) -> str | None:
    if local_album_id is not None:
        local_source = (
            session.execute(
                text(
                    """
                    SELECT global_entity_uid::text AS global_album_uid
                    FROM global_catalog_sources
                    WHERE source_kind = 'local'
                      AND entity_type = 'album'
                      AND local_id = :local_album_id
                      AND source_deleted_at IS NULL
                      AND NOT source_stale
                    LIMIT 1
                    """
                ),
                {"local_album_id": local_album_id},
            )
            .mappings()
            .first()
        )
        if local_source:
            return local_source["global_album_uid"]

    if not album_name:
        return None
    normalized_name = normalize_name(album_name, strip_edition=True)
    row = (
        session.execute(
            text(
                """
                SELECT global_album_uid::text AS global_album_uid
                FROM global_catalog_albums
                WHERE normalized_name = :normalized_name
                  AND artist_name = :artist_name
                ORDER BY has_local DESC, source_count DESC, canonical_name ASC
                LIMIT 1
                """
            ),
            {"normalized_name": normalized_name, "artist_name": artist_name},
        )
        .mappings()
        .first()
    )
    return row["global_album_uid"] if row else None


def _find_local_track_artist_uid(
    session,
    *,
    album_uid: str | None,
    track_artist_name: str,
) -> str | None:
    if album_uid is not None:
        artist_uid = session.execute(
            text(
                """
                SELECT global_artist_uid::text
                FROM global_catalog_albums
                WHERE global_album_uid = CAST(:album_uid AS uuid)
                """
            ),
            {"album_uid": album_uid},
        ).scalar_one_or_none()
        if artist_uid is not None:
            return str(artist_uid)
    return _find_artist_uid(session, track_artist_name)


def _source_conflict_target(source: dict[str, Any]) -> str:
    if source["source_kind"] == "federated":
        return (
            "(node_uid, entity_type, remote_entity_uid) WHERE source_kind = 'federated'"
        )
    if not source.get("local_entity_uid"):
        return (
            "(entity_type, local_id) "
            "WHERE source_kind = 'local' AND local_id IS NOT NULL"
        )
    return (
        "(entity_type, local_entity_uid) "
        "WHERE source_kind = 'local' AND local_entity_uid IS NOT NULL"
    )


def _canonical_has_local(session, entity_type: str, global_uid: str) -> bool:
    table_name, id_column = _canonical_table(entity_type)
    row = session.execute(
        text(f"SELECT has_local FROM {table_name} WHERE {id_column} = :global_uid"),
        {"global_uid": global_uid},
    ).first()
    return bool(row[0]) if row else False


def _refresh_source_count(session, entity_type: str, global_uid: str) -> None:
    table_name, id_column = _canonical_table(entity_type)
    session.execute(
        text(
            f"""
            UPDATE {table_name}
            SET
                source_count = counts.source_count,
                has_local = counts.has_local,
                has_remote = counts.has_remote,
                updated_at = NOW()
            FROM (
                SELECT
                    COUNT(*)::integer AS source_count,
                    COALESCE(BOOL_OR(source_kind = 'local'), false) AS has_local,
                    COALESCE(BOOL_OR(source_kind = 'federated'), false) AS has_remote
                FROM global_catalog_sources
                WHERE entity_type = :entity_type
                  AND global_entity_uid = :global_uid
                  AND source_deleted_at IS NULL
                  AND NOT source_stale
            ) AS counts
            WHERE {id_column} = :global_uid
            """
        ),
        {"entity_type": entity_type, "global_uid": global_uid},
    )


def _refresh_artist_has_photo(session, global_uid: str) -> None:
    session.execute(
        text(
            """
            UPDATE global_catalog_artists
            SET has_photo = COALESCE(photo_sources.has_photo, false),
                updated_at = NOW()
            FROM (
                SELECT BOOL_OR(
                    COALESCE(
                        (source_payload_json->>'has_photo')::boolean,
                        ((source_payload_json->'facets'->'artist_photo'->>'available')::boolean),
                        false
                    )
                ) AS has_photo
                FROM global_catalog_sources
                WHERE entity_type = 'artist'
                  AND global_entity_uid = :global_uid
                  AND NOT source_stale
                  AND source_deleted_at IS NULL
            ) AS photo_sources
            WHERE global_artist_uid = :global_uid
            """
        ),
        {"global_uid": global_uid},
    )


def _canonical_table(entity_type: str) -> tuple[str, str]:
    if entity_type == "artist":
        return "global_catalog_artists", "global_artist_uid"
    if entity_type == "album":
        return "global_catalog_albums", "global_album_uid"
    if entity_type == "track":
        return "global_catalog_tracks", "global_track_uid"
    raise ValueError(f"Unsupported entity type: {entity_type}")


def _source_ref(source: dict[str, Any]) -> dict[str, Any]:
    return {
        "source_kind": source["source_kind"],
        "node_uid": source["node_uid"],
        "remote_entity_uid": source["remote_entity_uid"],
        "local_id": source["local_id"],
        "local_entity_uid": source["local_entity_uid"],
    }


def _match_ref(source: dict[str, Any]) -> dict[str, Any]:
    return {
        "match_key": source["match_key"],
        "confidence": source["match_confidence"],
        "method": source["match_method"],
    }


def _json(value: Any) -> str:
    return json.dumps(value, sort_keys=True)


__all__ = [
    "prune_local_catalog_sources_batch",
    "prune_remote_catalog_sources_batch",
    "reconcile_local_catalog",
    "reconcile_remote_catalog",
]
