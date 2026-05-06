from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from crate.media_worker_progress import media_worker_admission
from crate.portable_metadata import PORTABLE_SCHEMA_VERSION

log = logging.getLogger(__name__)

_DEFAULT_TIMEOUT_SECONDS = 900
_ARTWORK_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
_ARTWORK_NAMES = {"cover", "folder", "front", "album", "artwork"}


def media_worker_url() -> str | None:
    raw = os.environ.get("CRATE_MEDIA_WORKER_URL", "").strip()
    return raw.rstrip("/") if raw else None


def media_worker_timeout_seconds() -> int:
    raw = os.environ.get("CRATE_MEDIA_WORKER_TIMEOUT_SECONDS")
    try:
        return max(1, int(raw)) if raw else _DEFAULT_TIMEOUT_SECONDS
    except ValueError:
        return _DEFAULT_TIMEOUT_SECONDS


def build_album_download_package(
    album_payload: dict[str, Any],
    *,
    output_path: str | Path,
    filename: str,
    job_id: str | None = None,
    artwork_path: str | Path | None = None,
    write_rich_tags: bool = True,
    progress_path: str | Path | None = None,
    cancel_path: str | Path | None = None,
    cache_kind: str | None = None,
    cache_key: str | None = None,
    cache_metadata: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    base_url = media_worker_url()
    if not base_url:
        return None

    job = _album_package_job(
        album_payload,
        output_path=output_path,
        filename=filename,
        job_id=job_id,
        artwork_path=artwork_path,
        write_rich_tags=write_rich_tags,
        progress_path=progress_path,
        cancel_path=cancel_path,
        cache_kind=cache_kind,
        cache_key=cache_key,
        cache_metadata=cache_metadata,
    )
    try:
        timeout = media_worker_timeout_seconds()
        with media_worker_admission(str(job.get("job_id") or output_path), ttl_seconds=timeout + 60) as lease:
            if lease is None:
                _record_media_worker_metric("media_worker.admission.denied", tags={"kind": "album"})
                return None
            result = _post_json(f"{base_url}/v1/packages/album", job, timeout=timeout)
            _record_media_worker_result("album", result)
            return result
    except Exception:
        log.debug("crate-media-worker album package failed; falling back to Python", exc_info=True)
        return None


def build_track_download_artifact(
    track_payload: dict[str, Any],
    *,
    source_path: str | Path,
    output_path: str | Path,
    filename: str,
    job_id: str | None = None,
    artwork_path: str | Path | None = None,
    write_rich_tags: bool = True,
    progress_path: str | Path | None = None,
    cancel_path: str | Path | None = None,
    cache_kind: str | None = None,
    cache_key: str | None = None,
    cache_metadata: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    base_url = media_worker_url()
    if not base_url:
        return None

    job = _track_artifact_job(
        track_payload,
        source_path=source_path,
        output_path=output_path,
        filename=filename,
        job_id=job_id,
        artwork_path=artwork_path,
        write_rich_tags=write_rich_tags,
        progress_path=progress_path,
        cancel_path=cancel_path,
        cache_kind=cache_kind,
        cache_key=cache_key,
        cache_metadata=cache_metadata,
    )
    try:
        timeout = media_worker_timeout_seconds()
        with media_worker_admission(str(job.get("job_id") or output_path), ttl_seconds=timeout + 60) as lease:
            if lease is None:
                _record_media_worker_metric("media_worker.admission.denied", tags={"kind": "track"})
                return None
            result = _post_json(f"{base_url}/v1/packages/track", job, timeout=timeout)
            _record_media_worker_result("track", result)
            return result
    except Exception:
        log.debug("crate-media-worker track artifact failed; falling back to Python", exc_info=True)
        return None


def _post_json(url: str, payload: dict[str, Any], *, timeout: int) -> dict[str, Any] | None:
    body = json.dumps(payload, ensure_ascii=False, default=_json_default).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8"))
        except Exception:
            payload = {"ok": False, "errors": [str(exc)]}
        log.debug("crate-media-worker returned %s: %s", exc.code, payload)
        return payload


def _record_media_worker_metric(name: str, value: float = 1.0, tags: dict[str, str] | None = None) -> None:
    try:
        from crate.metrics import record_later

        record_later(name, value, tags=tags)
    except Exception:
        pass


def _record_media_worker_result(kind: str, result: dict[str, Any] | None) -> None:
    tags = {"kind": kind}
    if not result:
        _record_media_worker_metric("media_worker.package.failed", tags=tags)
        return
    if result.get("ok"):
        _record_media_worker_metric("media_worker.package.completed", tags=tags)
        _record_media_worker_metric("media_worker.package.duration", float(result.get("duration_ms") or 0), tags=tags)
        _record_media_worker_metric("media_worker.package.bytes", float(result.get("bytes") or 0), tags=tags)
        cache = result.get("cache") or {}
        pruned = cache.get("pruned") if isinstance(cache, dict) else None
        if isinstance(pruned, dict):
            _record_media_worker_metric("media_worker.cache.pruned", float(pruned.get("removed") or 0), tags=tags)
            _record_media_worker_metric("media_worker.cache.bytes_removed", float(pruned.get("bytes_removed") or 0), tags=tags)
    else:
        _record_media_worker_metric("media_worker.package.failed", tags=tags)


def _album_package_job(
    album_payload: dict[str, Any],
    *,
    output_path: str | Path,
    filename: str,
    job_id: str | None,
    artwork_path: str | Path | None,
    write_rich_tags: bool,
    progress_path: str | Path | None = None,
    cancel_path: str | Path | None = None,
    cache_kind: str | None = None,
    cache_key: str | None = None,
    cache_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    artist = dict(album_payload.get("artist") or {})
    album = dict(album_payload.get("album") or {})
    sidecar = dict(album_payload)
    sidecar["schema_version"] = PORTABLE_SCHEMA_VERSION
    sidecar["generated_at"] = datetime.now(timezone.utc).isoformat()

    primary_artwork = str(artwork_path) if artwork_path else None
    tracks = []
    for track in album_payload.get("tracks") or []:
        track_payload = dict(track)
        if artist.get("entity_uid"):
            track_payload["artist_entity_uid"] = artist.get("entity_uid")
        if album.get("entity_uid"):
            track_payload["album_entity_uid"] = album.get("entity_uid")
        source_path = str(track_payload.get("path") or "")
        tracks.append(
            {
                "source_path": source_path,
                "relative_path": track_payload.get("relative_path") or track_payload.get("filename") or Path(source_path).name,
                "filename": track_payload.get("filename") or Path(source_path).name,
                "metadata": track_payload,
                "artwork_path": primary_artwork,
            }
        )

    return {
        "job_id": job_id,
        "output_path": str(output_path),
        "filename": filename,
        "progress_path": str(progress_path) if progress_path else None,
        "cancel_path": str(cancel_path) if cancel_path else None,
        "write_rich_tags": write_rich_tags,
        "cache": _download_cache_policy(cache_kind, cache_key, filename, cache_metadata),
        "primary_artwork_path": primary_artwork,
        "tracks": tracks,
        "artwork_files": _artwork_entries(album, primary_artwork),
        "extra_files": [],
        "sidecar_json": sidecar,
    }


def _track_artifact_job(
    track_payload: dict[str, Any],
    *,
    source_path: str | Path,
    output_path: str | Path,
    filename: str,
    job_id: str | None,
    artwork_path: str | Path | None,
    write_rich_tags: bool,
    progress_path: str | Path | None = None,
    cancel_path: str | Path | None = None,
    cache_kind: str | None = None,
    cache_key: str | None = None,
    cache_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    artist = dict(track_payload.get("artist") or {})
    album = dict(track_payload.get("album") or {})
    track = dict(track_payload.get("track") or {})
    if artist.get("entity_uid"):
        track["artist_entity_uid"] = artist.get("entity_uid")
    if album.get("entity_uid"):
        track["album_entity_uid"] = album.get("entity_uid")

    return {
        "job_id": job_id,
        "source_path": str(source_path),
        "output_path": str(output_path),
        "filename": filename,
        "progress_path": str(progress_path) if progress_path else None,
        "cancel_path": str(cancel_path) if cancel_path else None,
        "artwork_path": str(artwork_path) if artwork_path else None,
        "metadata": track,
        "package_json": {"artist": artist, "album": album},
        "write_rich_tags": write_rich_tags,
        "cache": _download_cache_policy(cache_kind, cache_key, filename, cache_metadata),
    }


def _download_cache_policy(
    kind: str | None,
    key: str | None,
    filename: str,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    if not kind or not key:
        return None
    from crate.download_cache import (
        album_cache_ttl_seconds,
        download_cache_max_bytes,
        download_cache_root,
        track_cache_ttl_seconds,
    )

    return {
        "root": str(download_cache_root()),
        "kind": kind,
        "key": key,
        "filename": filename,
        "max_bytes": download_cache_max_bytes(),
        "album_ttl_seconds": album_cache_ttl_seconds(),
        "track_ttl_seconds": track_cache_ttl_seconds(),
        "metadata": metadata or {},
    }


def _artwork_entries(album: dict[str, Any], primary_artwork: str | None) -> list[dict[str, str]]:
    seen: set[str] = set()
    entries: list[dict[str, str]] = []
    album_dir = Path(str(album.get("path") or ""))
    for name in album.get("artwork_files") or []:
        path = album_dir / str(name)
        if path.is_file() and path.suffix.lower() in _ARTWORK_EXTENSIONS:
            seen.add(str(path))
            entries.append({"source_path": str(path), "relative_path": path.name, "kind": "artwork"})

    if primary_artwork:
        path = Path(primary_artwork)
        if path.is_file() and str(path) not in seen:
            seen.add(str(path))
            entries.append({"source_path": str(path), "relative_path": path.name, "kind": "artwork"})

    if not entries and album_dir.is_dir():
        for child in sorted(album_dir.iterdir()):
            if not child.is_file() or child.suffix.lower() not in _ARTWORK_EXTENSIONS:
                continue
            stem = child.stem.lower().strip()
            if stem in _ARTWORK_NAMES or stem.startswith("cover"):
                entries.append({"source_path": str(child), "relative_path": child.name, "kind": "artwork"})
                break
    return entries


def _json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    return str(value)


__all__ = [
    "build_album_download_package",
    "build_track_download_artifact",
    "media_worker_timeout_seconds",
    "media_worker_url",
]
