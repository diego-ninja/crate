from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def _int(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def get_playback_delivery_snapshot(*, limit: int = 20) -> dict:
    safe_limit = min(max(int(limit or 20), 1), 100)
    with read_scope() as session:
        variant_stats = session.execute(
            text(
                """
                SELECT
                    COUNT(*) AS variants,
                    COUNT(DISTINCT sv.track_id) FILTER (WHERE sv.track_id IS NOT NULL) AS variant_tracks,
                    COUNT(*) FILTER (WHERE status = 'ready') AS ready,
                    COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                    COUNT(*) FILTER (WHERE status = 'running') AS running,
                    COUNT(*) FILTER (WHERE status = 'failed') AS failed,
                    COUNT(*) FILTER (WHERE status = 'missing') AS missing,
                    COUNT(DISTINCT sv.track_id) FILTER (WHERE status = 'ready' AND sv.track_id IS NOT NULL) AS ready_tracks,
                    COALESCE(SUM(bytes) FILTER (WHERE status = 'ready'), 0) AS cached_bytes,
                    COALESCE(SUM(source_size) FILTER (WHERE status = 'ready'), 0) AS ready_source_bytes,
                    AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) FILTER (WHERE status = 'ready' AND completed_at IS NOT NULL) AS avg_prepare_seconds
                FROM stream_variants sv
                JOIN library_tracks lt
                  ON lt.id = sv.track_id
                 AND lt.path = sv.source_path
                 AND COALESCE(lt.size, 0) = sv.source_size
                """
            )
        ).mappings().first() or {}
        library_stats = session.execute(
            text(
                """
                SELECT
                    COUNT(*) AS tracks,
                    COUNT(*) FILTER (
                        WHERE lower(COALESCE(format, '')) IN ('flac', 'wav', 'alac', 'aiff', 'aif')
                           OR lower(path) LIKE '%.flac'
                           OR lower(path) LIKE '%.wav'
                           OR lower(path) LIKE '%.aiff'
                           OR lower(path) LIKE '%.aif'
                    ) AS lossless_tracks,
                    COUNT(*) FILTER (
                        WHERE COALESCE(sample_rate, 0) > 48000
                           OR COALESCE(bit_depth, 0) > 16
                    ) AS hires_tracks
                FROM library_tracks
                """
            )
        ).mappings().first() or {}
        recent_rows = session.execute(
            text(
                """
                SELECT
                    sv.id,
                    sv.cache_key,
                    sv.track_id,
                    sv.track_entity_uid,
                    sv.preset,
                    sv.status,
                    sv.delivery_format,
                    sv.delivery_codec,
                    sv.delivery_bitrate,
                    sv.delivery_sample_rate,
                    sv.source_format,
                    sv.source_bitrate,
                    sv.source_sample_rate,
                    sv.source_bit_depth,
                    sv.source_size,
                    sv.bytes,
                    sv.error,
                    sv.task_id,
                    sv.created_at,
                    sv.updated_at,
                    sv.completed_at,
                    t.status AS task_status,
                    lt.title,
                    lt.artist,
                    lt.album
                FROM stream_variants sv
                LEFT JOIN tasks t ON t.id = sv.task_id
                JOIN library_tracks lt
                  ON lt.id = sv.track_id
                 AND lt.path = sv.source_path
                 AND COALESCE(lt.size, 0) = sv.source_size
                ORDER BY sv.updated_at DESC
                LIMIT :limit
                """
            ),
            {"limit": safe_limit},
        ).mappings().all()

    ready_source_bytes = _int(variant_stats.get("ready_source_bytes"))
    cached_bytes = _int(variant_stats.get("cached_bytes"))
    lossless_tracks = _int(library_stats.get("lossless_tracks"))
    ready_tracks = _int(variant_stats.get("ready_tracks"))
    return {
        "stats": {
            "tracks": _int(library_stats.get("tracks")),
            "lossless_tracks": lossless_tracks,
            "hires_tracks": _int(library_stats.get("hires_tracks")),
            "variants": _int(variant_stats.get("variants")),
            "variant_tracks": _int(variant_stats.get("variant_tracks")),
            "ready": _int(variant_stats.get("ready")),
            "pending": _int(variant_stats.get("pending")),
            "running": _int(variant_stats.get("running")),
            "failed": _int(variant_stats.get("failed")),
            "missing": _int(variant_stats.get("missing")),
            "ready_tracks": ready_tracks,
            "cached_bytes": cached_bytes,
            "ready_source_bytes": ready_source_bytes,
            "estimated_saved_bytes": max(0, ready_source_bytes - cached_bytes),
            "coverage_percent": round((ready_tracks / lossless_tracks) * 100, 1) if lossless_tracks else 0,
            "avg_prepare_seconds": _float(variant_stats.get("avg_prepare_seconds")),
        },
        "recent_variants": [
            {
                **dict(row),
                "track_entity_uid": str(row["track_entity_uid"]) if row.get("track_entity_uid") is not None else None,
            }
            for row in recent_rows
        ],
    }


def get_track_variant_summaries(track_ids: list[int]) -> dict[int, list[dict]]:
    if not track_ids:
        return {}

    cleaned_ids = sorted({int(track_id) for track_id in track_ids if track_id is not None})
    if not cleaned_ids:
        return {}

    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    sv.id,
                    sv.track_id,
                    sv.preset,
                    sv.status,
                    sv.delivery_format,
                    sv.delivery_codec,
                    sv.delivery_bitrate,
                    sv.delivery_sample_rate,
                    sv.bytes,
                    sv.error,
                    sv.task_id,
                    sv.updated_at,
                    sv.completed_at,
                    t.status AS task_status
                FROM stream_variants sv
                JOIN library_tracks lt
                  ON lt.id = sv.track_id
                 AND lt.path = sv.source_path
                 AND COALESCE(lt.size, 0) = sv.source_size
                LEFT JOIN tasks t ON t.id = sv.task_id
                WHERE sv.track_id = ANY(:track_ids)
                ORDER BY sv.track_id, sv.preset, sv.updated_at DESC
                """
            ),
            {"track_ids": cleaned_ids},
        ).mappings().all()

    grouped: dict[int, list[dict]] = {}
    for row in rows:
        track_id = _int(row.get("track_id"))
        if track_id <= 0:
            continue
        grouped.setdefault(track_id, []).append(dict(row))
    return grouped
