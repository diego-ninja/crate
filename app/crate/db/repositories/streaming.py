from __future__ import annotations

import uuid
from pathlib import Path

from sqlalchemy import text

from crate.config import load_config
from crate.db.tx import transaction_scope


def get_track_delivery_row_by_id(track_id: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                SELECT id, entity_uid, path, title, artist, album, format, bitrate,
                       sample_rate, bit_depth, duration, size
                FROM library_tracks
                WHERE id = :track_id
                LIMIT 1
                """
            ),
            {"track_id": track_id},
        ).mappings().first()
        return dict(row) if row else None


def get_track_delivery_row_by_entity_uid(entity_uid: str) -> dict | None:
    try:
        normalized = str(uuid.UUID(str(entity_uid)))
    except Exception:
        return None
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                SELECT id, entity_uid, path, title, artist, album, format, bitrate,
                       sample_rate, bit_depth, duration, size
                FROM library_tracks
                WHERE entity_uid = CAST(:entity_uid AS uuid)
                LIMIT 1
                """
            ),
            {"entity_uid": normalized},
        ).mappings().first()
        return dict(row) if row else None


def get_track_delivery_row_by_path(filepath: str) -> dict | None:
    candidates = _track_path_candidates(filepath)
    if not candidates:
        return None
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                SELECT id, entity_uid, path, title, artist, album, format, bitrate,
                       sample_rate, bit_depth, duration, size
                FROM library_tracks
                WHERE path = ANY(:paths)
                ORDER BY CASE WHEN path = :preferred_path THEN 0 ELSE 1 END
                LIMIT 1
                """
            ),
            {"paths": candidates, "preferred_path": filepath},
        ).mappings().first()
        return dict(row) if row else None


def _track_path_candidates(filepath: str) -> list[str]:
    cleaned = str(filepath or "").strip()
    if not cleaned:
        return []

    candidates: list[str] = []

    def add(value: str) -> None:
        if value and value not in candidates:
            candidates.append(value)

    add(cleaned)
    try:
        library_root = str(Path(load_config().get("library_path", "/music")).resolve())
    except Exception:
        library_root = "/music"

    if cleaned.startswith("/music/") and library_root != "/music":
        add(str(Path(library_root) / cleaned[len("/music/"):]))
    elif not cleaned.startswith("/"):
        add(str(Path(library_root) / cleaned.lstrip("/")))

    return candidates


def get_variant_by_cache_key(cache_key: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT * FROM stream_variants WHERE cache_key = :cache_key LIMIT 1"),
            {"cache_key": cache_key},
        ).mappings().first()
        return dict(row) if row else None


def get_variant_by_id(variant_id: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT * FROM stream_variants WHERE id = :variant_id LIMIT 1"),
            {"variant_id": variant_id},
        ).mappings().first()
        return dict(row) if row else None


def ensure_variant_record(payload: dict) -> dict:
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                INSERT INTO stream_variants (
                    id, cache_key, track_id, track_entity_uid, source_path,
                    source_mtime_ns, source_size, source_format, source_bitrate,
                    source_sample_rate, source_bit_depth, preset, delivery_format,
                    delivery_codec, delivery_bitrate, delivery_sample_rate, status,
                    relative_path, bytes, error, updated_at
                )
                VALUES (
                    :id, :cache_key, :track_id, CAST(:track_entity_uid AS uuid), :source_path,
                    :source_mtime_ns, :source_size, :source_format, :source_bitrate,
                    :source_sample_rate, :source_bit_depth, :preset, :delivery_format,
                    :delivery_codec, :delivery_bitrate, :delivery_sample_rate, 'pending',
                    :relative_path, NULL, NULL, NOW()
                )
                ON CONFLICT (cache_key) DO UPDATE SET
                    updated_at = NOW(),
                    source_path = EXCLUDED.source_path,
                    source_mtime_ns = EXCLUDED.source_mtime_ns,
                    source_size = EXCLUDED.source_size,
                    source_format = EXCLUDED.source_format,
                    source_bitrate = EXCLUDED.source_bitrate,
                    source_sample_rate = EXCLUDED.source_sample_rate,
                    source_bit_depth = EXCLUDED.source_bit_depth,
                    relative_path = EXCLUDED.relative_path,
                    status = CASE
                        WHEN stream_variants.status = 'failed' THEN 'pending'
                        WHEN stream_variants.source_path IS DISTINCT FROM EXCLUDED.source_path
                          OR stream_variants.source_mtime_ns IS DISTINCT FROM EXCLUDED.source_mtime_ns
                          OR stream_variants.source_size IS DISTINCT FROM EXCLUDED.source_size
                        THEN 'pending'
                        ELSE stream_variants.status
                    END,
                    bytes = CASE
                        WHEN stream_variants.source_path IS DISTINCT FROM EXCLUDED.source_path
                          OR stream_variants.source_mtime_ns IS DISTINCT FROM EXCLUDED.source_mtime_ns
                          OR stream_variants.source_size IS DISTINCT FROM EXCLUDED.source_size
                        THEN NULL
                        ELSE stream_variants.bytes
                    END,
                    error = CASE
                        WHEN stream_variants.status = 'failed' THEN NULL
                        WHEN stream_variants.source_path IS DISTINCT FROM EXCLUDED.source_path
                          OR stream_variants.source_mtime_ns IS DISTINCT FROM EXCLUDED.source_mtime_ns
                          OR stream_variants.source_size IS DISTINCT FROM EXCLUDED.source_size
                        THEN NULL
                        ELSE stream_variants.error
                    END,
                    task_id = CASE
                        WHEN stream_variants.source_path IS DISTINCT FROM EXCLUDED.source_path
                          OR stream_variants.source_mtime_ns IS DISTINCT FROM EXCLUDED.source_mtime_ns
                          OR stream_variants.source_size IS DISTINCT FROM EXCLUDED.source_size
                        THEN NULL
                        ELSE stream_variants.task_id
                    END,
                    completed_at = CASE
                        WHEN stream_variants.source_path IS DISTINCT FROM EXCLUDED.source_path
                          OR stream_variants.source_mtime_ns IS DISTINCT FROM EXCLUDED.source_mtime_ns
                          OR stream_variants.source_size IS DISTINCT FROM EXCLUDED.source_size
                        THEN NULL
                        ELSE stream_variants.completed_at
                    END
                RETURNING *
                """
            ),
            payload,
        ).mappings().one()
        return dict(row)


def mark_variant_task(cache_key: str, task_id: str | None) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE stream_variants
                SET task_id = :task_id, updated_at = NOW()
                WHERE cache_key = :cache_key
                """
            ),
            {"cache_key": cache_key, "task_id": task_id},
        )


def mark_variant_running(cache_key: str, task_id: str | None) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE stream_variants
                SET status = 'running',
                    task_id = COALESCE(:task_id, task_id),
                    error = NULL,
                    updated_at = NOW()
                WHERE cache_key = :cache_key
                """
            ),
            {"cache_key": cache_key, "task_id": task_id},
        )


def mark_variant_ready(cache_key: str, relative_path: str, byte_count: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                UPDATE stream_variants
                SET status = 'ready',
                    relative_path = :relative_path,
                    bytes = :bytes,
                    error = NULL,
                    completed_at = NOW(),
                    updated_at = NOW()
                WHERE cache_key = :cache_key
                RETURNING *
                """
            ),
            {"cache_key": cache_key, "relative_path": relative_path, "bytes": byte_count},
        ).mappings().first()
        return dict(row) if row else None


def mark_variant_failed(cache_key: str, error: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE stream_variants
                SET status = 'failed',
                    error = :error,
                    updated_at = NOW()
                WHERE cache_key = :cache_key
                """
            ),
            {"cache_key": cache_key, "error": error[:2000]},
        )


def mark_variant_missing(cache_key: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE stream_variants
                SET status = 'pending',
                    error = NULL,
                    relative_path = NULL,
                    bytes = NULL,
                    completed_at = NULL,
                    updated_at = NOW()
                WHERE cache_key = :cache_key
                """
            ),
            {"cache_key": cache_key},
        )
