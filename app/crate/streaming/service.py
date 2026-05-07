from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from pathlib import Path

from crate.audio import read_audio_quality
from crate.api._deps import library_path, safe_path
from crate.db.repositories.tasks import create_task_dedup
from crate.streaming.paths import resolve_data_file, variant_relative_path
from crate.streaming.policy import (
    ORIGINAL_POLICY,
    PIPELINE_VERSION,
    DeliveryDecision,
    bitrate_to_kbps,
    decide_delivery,
    delivery_sample_rate,
    infer_format,
    normalize_policy,
)
from crate.db.repositories.streaming import (
    ensure_variant_record,
    get_variant_by_cache_key,
    mark_variant_missing,
    mark_variant_task,
)


@dataclass(frozen=True)
class PlaybackResolution:
    requested_policy: str
    effective_policy: str
    file_path: Path
    media_type: str
    source: dict
    delivery: dict
    transcoded: bool
    cache_hit: bool
    preparing: bool
    task_id: str | None
    variant_id: str | None
    variant_status: str | None


STREAM_MEDIA_TYPES = {
    ".flac": "audio/flac",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
    ".wav": "audio/wav",
}


def media_type_for_path(path: Path) -> str:
    return STREAM_MEDIA_TYPES.get(path.suffix.lower(), "audio/mpeg")


def resolve_source_path(track: dict) -> Path | None:
    raw_path = str(track.get("path") or "")
    if not raw_path:
        return None
    lib = library_path()
    lib_str = str(lib)
    filepath = raw_path
    if filepath.startswith(lib_str):
        filepath = filepath[len(lib_str):].lstrip("/")
    elif filepath.startswith("/music/"):
        filepath = filepath[len("/music/"):].lstrip("/")
    return safe_path(lib, filepath)


def _source_quality(track: dict, source_path: Path, stat, *, probe_missing: bool = True) -> dict:
    source_format = infer_format(track.get("format"), source_path)
    bitrate_kbps = bitrate_to_kbps(track.get("bitrate"))
    sample_rate = track.get("sample_rate")
    bit_depth = track.get("bit_depth")
    if probe_missing and (bitrate_kbps is None or sample_rate is None or bit_depth is None):
        quality = read_audio_quality(source_path)
        bitrate_kbps = bitrate_kbps or bitrate_to_kbps(quality.get("bitrate"))
        sample_rate = sample_rate or quality.get("sample_rate")
        bit_depth = bit_depth or quality.get("bit_depth")
    return {
        "format": source_format or source_path.suffix.lower().lstrip("."),
        "bitrate": bitrate_kbps,
        "sample_rate": sample_rate,
        "bit_depth": bit_depth,
        "bytes": int(stat.st_size),
        "lossless": source_format in {"flac", "wav", "alac", "aiff", "aif"},
    }


def _descriptor(track: dict, source_path: Path, decision: DeliveryDecision) -> dict:
    if decision.preset is None:
        raise ValueError("A transcode descriptor requires a delivery preset")
    stat = source_path.stat()
    entity_uid = str(track.get("entity_uid")) if track.get("entity_uid") is not None else None
    identity = entity_uid or str(track.get("id") or source_path)
    source_format = infer_format(track.get("format"), source_path)
    source_sample_rate = int(track.get("sample_rate") or 0) or None
    key_material = "|".join(
        [
            PIPELINE_VERSION,
            identity,
            str(source_path),
            str(stat.st_mtime_ns),
            str(stat.st_size),
            decision.preset.policy,
            str(decision.preset.bitrate_kbps),
        ]
    )
    cache_key = hashlib.sha256(key_material.encode("utf-8")).hexdigest()
    relative_path = variant_relative_path(cache_key, decision.preset.policy, decision.preset.extension)
    return {
        "id": uuid.uuid4().hex,
        "cache_key": cache_key,
        "track_id": track.get("id"),
        "track_entity_uid": entity_uid,
        "source_path": str(source_path),
        "source_mtime_ns": stat.st_mtime_ns,
        "source_size": stat.st_size,
        "source_format": source_format,
        "source_bitrate": bitrate_to_kbps(track.get("bitrate")),
        "source_sample_rate": source_sample_rate,
        "source_bit_depth": track.get("bit_depth"),
        "preset": decision.preset.policy,
        "delivery_format": decision.preset.format,
        "delivery_codec": decision.preset.codec,
        "delivery_bitrate": decision.preset.bitrate_kbps,
        "delivery_sample_rate": delivery_sample_rate(source_sample_rate),
        "relative_path": relative_path,
    }


def _variant_matches_descriptor(row: dict, descriptor: dict) -> bool:
    return (
        str(row.get("source_path") or "") == str(descriptor.get("source_path") or "")
        and int(row.get("source_mtime_ns") or 0) == int(descriptor.get("source_mtime_ns") or 0)
        and int(row.get("source_size") or 0) == int(descriptor.get("source_size") or 0)
        and str(row.get("relative_path") or "") == str(descriptor.get("relative_path") or "")
    )


def _passthrough_resolution(track: dict, source_path: Path, requested_policy: str, reason: str) -> PlaybackResolution:
    stat = source_path.stat()
    source = _source_quality(track, source_path, stat, probe_missing=False)
    return PlaybackResolution(
        requested_policy=normalize_policy(requested_policy),
        effective_policy="original",
        file_path=source_path,
        media_type=media_type_for_path(source_path),
        source=source,
        delivery={**source, "reason": reason},
        transcoded=False,
        cache_hit=False,
        preparing=False,
        task_id=None,
        variant_id=None,
        variant_status=None,
    )


def resolve_playback(track: dict, requested_policy: str | None, *, enqueue: bool = True) -> PlaybackResolution | None:
    source_path = resolve_source_path(track)
    if not source_path or not source_path.is_file():
        return None

    decision = decide_delivery(track, source_path, requested_policy)
    if decision.passthrough:
        return _passthrough_resolution(track, source_path, decision.requested_policy, decision.reason)

    descriptor = _descriptor(track, source_path, decision)
    row = ensure_variant_record(descriptor)
    variant_path = resolve_data_file(row.get("relative_path"))
    if row.get("status") == "ready" and not _variant_matches_descriptor(row, descriptor):
        mark_variant_missing(row["cache_key"])
        row = get_variant_by_cache_key(row["cache_key"]) or row
        variant_path = resolve_data_file(row.get("relative_path"))
    if row.get("status") == "ready" and variant_path and variant_path.is_file():
        source = _source_quality(track, source_path, source_path.stat(), probe_missing=False)
        delivery = {
            "format": row.get("delivery_format"),
            "codec": row.get("delivery_codec"),
            "bitrate": row.get("delivery_bitrate"),
            "sample_rate": row.get("delivery_sample_rate"),
            "bit_depth": None,
            "bytes": row.get("bytes"),
            "lossless": False,
        }
        return PlaybackResolution(
            requested_policy=decision.requested_policy,
            effective_policy=decision.effective_policy,
            file_path=variant_path,
            media_type=media_type_for_path(variant_path),
            source=source,
            delivery=delivery,
            transcoded=True,
            cache_hit=True,
            preparing=False,
            task_id=row.get("task_id"),
            variant_id=row.get("id"),
            variant_status=row.get("status"),
        )

    if row.get("status") == "ready":
        mark_variant_missing(row["cache_key"])
        row = get_variant_by_cache_key(row["cache_key"]) or row

    task_id = row.get("task_id")
    if enqueue:
        created_task_id = create_task_dedup(
            "prepare_stream_variant",
            {"cache_key": row["cache_key"]},
            dedup_key=row["cache_key"],
        )
        if created_task_id:
            task_id = created_task_id
            mark_variant_task(row["cache_key"], task_id)

    fallback = _passthrough_resolution(track, source_path, decision.requested_policy, "variant_preparing")
    return PlaybackResolution(
        requested_policy=decision.requested_policy,
        effective_policy=fallback.effective_policy,
        file_path=fallback.file_path,
        media_type=fallback.media_type,
        source=fallback.source,
        delivery={
            "format": descriptor["delivery_format"],
            "codec": descriptor["delivery_codec"],
            "bitrate": descriptor["delivery_bitrate"],
            "sample_rate": descriptor["delivery_sample_rate"],
            "bit_depth": None,
            "bytes": None,
            "lossless": False,
            "fallback": True,
        },
        transcoded=False,
        cache_hit=False,
        preparing=True,
        task_id=task_id,
        variant_id=row.get("id"),
        variant_status=row.get("status"),
    )


def prepare_playback(track: dict, requested_policy: str | None) -> PlaybackResolution | None:
    source_path = resolve_source_path(track)
    if not source_path or not source_path.is_file():
        return None

    decision = decide_delivery(track, source_path, requested_policy)
    if decision.passthrough:
        return PlaybackResolution(
            requested_policy=decision.requested_policy,
            effective_policy=ORIGINAL_POLICY,
            file_path=source_path,
            media_type=media_type_for_path(source_path),
            source={},
            delivery={"reason": decision.reason},
            transcoded=False,
            cache_hit=False,
            preparing=False,
            task_id=None,
            variant_id=None,
            variant_status=None,
        )

    descriptor = _descriptor(track, source_path, decision)
    row = ensure_variant_record(descriptor)
    variant_path = resolve_data_file(row.get("relative_path"))
    if row.get("status") == "ready" and not _variant_matches_descriptor(row, descriptor):
        mark_variant_missing(row["cache_key"])
        row = get_variant_by_cache_key(row["cache_key"]) or row
        variant_path = resolve_data_file(row.get("relative_path"))
    if row.get("status") == "ready" and variant_path and variant_path.is_file():
        return PlaybackResolution(
            requested_policy=decision.requested_policy,
            effective_policy=decision.effective_policy,
            file_path=variant_path,
            media_type=media_type_for_path(variant_path),
            source={},
            delivery={
                "format": row.get("delivery_format"),
                "codec": row.get("delivery_codec"),
                "bitrate": row.get("delivery_bitrate"),
                "sample_rate": row.get("delivery_sample_rate"),
                "bit_depth": None,
                "bytes": row.get("bytes"),
                "lossless": False,
            },
            transcoded=True,
            cache_hit=True,
            preparing=False,
            task_id=row.get("task_id"),
            variant_id=row.get("id"),
            variant_status=row.get("status"),
        )

    if row.get("status") == "ready":
        mark_variant_missing(row["cache_key"])
        row = get_variant_by_cache_key(row["cache_key"]) or row

    task_id = row.get("task_id")
    created_task_id = create_task_dedup(
        "prepare_stream_variant",
        {"cache_key": row["cache_key"]},
        dedup_key=row["cache_key"],
    )
    if created_task_id:
        task_id = created_task_id
        mark_variant_task(row["cache_key"], task_id)

    return PlaybackResolution(
        requested_policy=decision.requested_policy,
        effective_policy=ORIGINAL_POLICY,
        file_path=source_path,
        media_type=media_type_for_path(source_path),
        source={},
        delivery={
            "format": descriptor["delivery_format"],
            "codec": descriptor["delivery_codec"],
            "bitrate": descriptor["delivery_bitrate"],
            "sample_rate": descriptor["delivery_sample_rate"],
            "bit_depth": None,
            "bytes": None,
            "lossless": False,
            "fallback": True,
        },
        transcoded=False,
        cache_hit=False,
        preparing=True,
        task_id=task_id,
        variant_id=row.get("id"),
        variant_status=row.get("status"),
    )


def resolution_to_payload(resolution: PlaybackResolution, stream_url: str) -> dict:
    return {
        "stream_url": stream_url,
        "requested_policy": resolution.requested_policy,
        "effective_policy": resolution.effective_policy,
        "source": resolution.source,
        "delivery": resolution.delivery,
        "transcoded": resolution.transcoded,
        "cache_hit": resolution.cache_hit,
        "preparing": resolution.preparing,
        "task_id": resolution.task_id,
        "variant_id": resolution.variant_id,
        "variant_status": resolution.variant_status,
    }
