from __future__ import annotations

import contextlib
import hashlib
import json
import os
import re
import shutil
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

from crate.streaming.paths import data_root


DOWNLOAD_CACHE_VERSION = "1"

_DEFAULT_MAX_BYTES = 50 * 1024**3
_DEFAULT_ALBUM_TTL_SECONDS = 7 * 86400
_DEFAULT_TRACK_TTL_SECONDS = 2 * 86400
_DEFAULT_LOCK_TIMEOUT_SECONDS = 900
_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._ -]+")


@dataclass(frozen=True)
class CachedDownload:
    key: str
    path: Path
    filename: str
    bytes: int


def _env_bool(name: str, default: bool = True) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


def _parse_bytes(raw: str | None, default: int) -> int:
    if raw is None or not raw.strip():
        return default
    text = raw.strip().lower()
    multiplier = 1
    for suffix, value in (("tb", 1024**4), ("gb", 1024**3), ("mb", 1024**2), ("kb", 1024)):
        if text.endswith(suffix):
            multiplier = value
            text = text[: -len(suffix)].strip()
            break
    try:
        return max(0, int(float(text) * multiplier))
    except ValueError:
        return default


def _parse_int(name: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


def download_cache_enabled() -> bool:
    return _env_bool("CRATE_DOWNLOAD_CACHE_ENABLED", True)


def download_cache_root() -> Path:
    raw = os.environ.get("CRATE_DOWNLOAD_CACHE_DIR")
    return Path(raw).resolve() if raw else data_root() / "download-cache"


def album_cache_ttl_seconds() -> int:
    return _parse_int("CRATE_DOWNLOAD_CACHE_ALBUM_TTL_SECONDS", _DEFAULT_ALBUM_TTL_SECONDS)


def track_cache_ttl_seconds() -> int:
    return _parse_int("CRATE_DOWNLOAD_CACHE_TRACK_TTL_SECONDS", _DEFAULT_TRACK_TTL_SECONDS)


def download_cache_max_bytes() -> int:
    return _parse_bytes(os.environ.get("CRATE_DOWNLOAD_CACHE_MAX_BYTES"), _DEFAULT_MAX_BYTES)


def safe_download_filename(value: str, fallback: str) -> str:
    text = str(value or "").replace("/", "-").replace("\\", "-")
    text = _SAFE_FILENAME_RE.sub("_", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    return text or fallback


def _json_default(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    return str(value)


def _stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=_json_default)


def _sha(value: Any) -> str:
    return hashlib.sha256(_stable_json(value).encode("utf-8")).hexdigest()


def _file_signature(path_value: Any) -> dict[str, Any] | None:
    path = Path(str(path_value or ""))
    if not path.is_file():
        return None
    stat = path.stat()
    return {
        "path": str(path),
        "mtime_ns": stat.st_mtime_ns,
        "size": stat.st_size,
    }


def _lyrics_signature(track: dict[str, Any]) -> dict[str, Any]:
    lyrics = track.get("lyrics") or {}
    plain = lyrics.get("plain") or lyrics.get("plainLyrics")
    synced = lyrics.get("synced") or lyrics.get("syncedLyrics")
    return {
        "provider": lyrics.get("provider"),
        "found": bool(lyrics.get("found")),
        "updated_at": lyrics.get("updated_at"),
        "plain_hash": hashlib.sha256(str(plain or "").encode("utf-8")).hexdigest() if plain else None,
        "synced_hash": hashlib.sha256(str(synced or "").encode("utf-8")).hexdigest() if synced else None,
    }


def _track_payload_signature(track: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": track.get("id"),
        "entity_uid": str(track.get("entity_uid")) if track.get("entity_uid") is not None else None,
        "path": track.get("path"),
        "relative_path": track.get("relative_path"),
        "filename": track.get("filename"),
        "audio_fingerprint": track.get("audio_fingerprint"),
        "audio_fingerprint_source": track.get("audio_fingerprint_source"),
        "analysis": track.get("analysis") or {},
        "bliss": track.get("bliss") or {},
        "lyrics": _lyrics_signature(track),
        "source": _file_signature(track.get("path")),
    }


def album_download_cache_key(album_payload: dict[str, Any], *, artwork_path: str | Path | None = None) -> str:
    album = album_payload.get("album") or {}
    artist = album_payload.get("artist") or {}
    material = {
        "version": DOWNLOAD_CACHE_VERSION,
        "kind": "album",
        "artist_uid": str(artist.get("entity_uid")) if artist.get("entity_uid") is not None else None,
        "album_id": album.get("id"),
        "album_uid": str(album.get("entity_uid")) if album.get("entity_uid") is not None else None,
        "album_path": album.get("path"),
        "artwork": _file_signature(artwork_path),
        "tracks": [_track_payload_signature(track) for track in album_payload.get("tracks") or []],
    }
    return _sha(material)


def track_download_cache_key(payload: dict[str, Any], *, source_path: str | Path, artwork_path: str | Path | None = None) -> str:
    track = payload.get("track") or {}
    album = payload.get("album") or {}
    artist = payload.get("artist") or {}
    material = {
        "version": DOWNLOAD_CACHE_VERSION,
        "kind": "track",
        "artist_uid": str(artist.get("entity_uid")) if artist.get("entity_uid") is not None else None,
        "album_uid": str(album.get("entity_uid")) if album.get("entity_uid") is not None else None,
        "track": _track_payload_signature({**track, "path": str(source_path)}),
        "artwork": _file_signature(artwork_path),
    }
    return _sha(material)


def _artifact_dir(kind: str, key: str) -> Path:
    return download_cache_root() / kind / key[:2] / key[2:4] / key


def _artifact_path(kind: str, key: str, filename: str) -> Path:
    return _artifact_dir(kind, key) / safe_download_filename(filename, f"{key}.bin")


def _manifest_path(kind: str, key: str) -> Path:
    return _artifact_dir(kind, key) / "manifest.json"


def _read_manifest(kind: str, key: str) -> dict[str, Any] | None:
    path = _manifest_path(kind, key)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_manifest(kind: str, key: str, payload: dict[str, Any]) -> None:
    path = _manifest_path(kind, key)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True, default=_json_default) + "\n", encoding="utf-8")
    tmp_path.replace(path)


def get_cached_download(kind: str, key: str, filename: str, *, ttl_seconds: int) -> CachedDownload | None:
    if not download_cache_enabled() or ttl_seconds <= 0:
        return None
    path = _artifact_path(kind, key, filename)
    manifest = _read_manifest(kind, key)
    if not manifest or manifest.get("key") != key or manifest.get("filename") != path.name or not path.is_file():
        return None

    now = time.time()
    created_at = float(manifest.get("created_at") or 0)
    if created_at <= 0 or now - created_at > ttl_seconds:
        remove_cached_download(kind, key)
        return None

    size = int(manifest.get("bytes") or 0)
    try:
        stat_size = path.stat().st_size
    except OSError:
        return None
    if size != stat_size:
        remove_cached_download(kind, key)
        return None

    manifest["last_accessed_at"] = now
    try:
        os.utime(path, (now, path.stat().st_mtime))
        _write_manifest(kind, key, manifest)
    except Exception:
        pass
    return CachedDownload(key=key, path=path, filename=path.name, bytes=stat_size)


def store_cached_download(kind: str, key: str, filename: str, source_path: str | Path, *, metadata: dict[str, Any] | None = None) -> CachedDownload | None:
    if not download_cache_enabled():
        return None
    source = Path(str(source_path))
    if not source.is_file():
        return None
    source_size = source.stat().st_size
    if source_size > download_cache_max_bytes():
        return None
    path = _artifact_path(kind, key, filename)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        shutil.copy2(source, tmp_path)
        tmp_path.replace(path)
        stat = path.stat()
        now = time.time()
        _write_manifest(
            kind,
            key,
            {
                "version": DOWNLOAD_CACHE_VERSION,
                "kind": kind,
                "key": key,
                "filename": path.name,
                "bytes": stat.st_size,
                "created_at": now,
                "last_accessed_at": now,
                "metadata": metadata or {},
            },
        )
        prune_download_cache()
        return CachedDownload(key=key, path=path, filename=path.name, bytes=stat.st_size)
    except Exception:
        with contextlib.suppress(Exception):
            tmp_path.unlink(missing_ok=True)
        return None


def remove_cached_download(kind: str, key: str) -> None:
    shutil.rmtree(_artifact_dir(kind, key), ignore_errors=True)


@contextlib.contextmanager
def download_cache_lock(kind: str, key: str, *, timeout_seconds: int = _DEFAULT_LOCK_TIMEOUT_SECONDS) -> Iterator[None]:
    if not download_cache_enabled():
        yield
        return

    import fcntl

    lock_dir = download_cache_root() / "locks" / kind
    lock_dir.mkdir(parents=True, exist_ok=True)
    lock_path = lock_dir / f"{key}.lock"
    deadline = time.monotonic() + max(1, timeout_seconds)
    with lock_path.open("w") as handle:
        while True:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
                    break
                time.sleep(0.25)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _iter_artifacts() -> list[tuple[Path, Path, dict[str, Any]]]:
    root = download_cache_root()
    if not root.is_dir():
        return []
    artifacts: list[tuple[Path, Path, dict[str, Any]]] = []
    for manifest_path in root.glob("*/*/*/*/manifest.json"):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            shutil.rmtree(manifest_path.parent, ignore_errors=True)
            continue
        filename = manifest.get("filename")
        artifact_path = manifest_path.parent / str(filename or "")
        if not filename or not artifact_path.is_file():
            shutil.rmtree(manifest_path.parent, ignore_errors=True)
            continue
        artifacts.append((artifact_path, manifest_path, manifest))
    return artifacts


def prune_download_cache(*, max_bytes: int | None = None) -> dict[str, Any]:
    if not download_cache_enabled():
        return {"removed": 0, "bytes_removed": 0, "bytes": 0, "limit": 0}

    limit = download_cache_max_bytes() if max_bytes is None else max(0, int(max_bytes))
    if limit <= 0:
        shutil.rmtree(download_cache_root(), ignore_errors=True)
        return {"removed": 0, "bytes_removed": 0, "bytes": 0, "limit": 0}

    now = time.time()
    removed = 0
    bytes_removed = 0
    survivors: list[tuple[Path, Path, dict[str, Any], int]] = []
    for artifact_path, manifest_path, manifest in _iter_artifacts():
        kind = str(manifest.get("kind") or "")
        ttl = album_cache_ttl_seconds() if kind == "album" else track_cache_ttl_seconds()
        created_at = float(manifest.get("created_at") or 0)
        try:
            size = artifact_path.stat().st_size
        except OSError:
            shutil.rmtree(manifest_path.parent, ignore_errors=True)
            continue
        if ttl > 0 and created_at > 0 and now - created_at > ttl:
            bytes_removed += size
            removed += 1
            shutil.rmtree(manifest_path.parent, ignore_errors=True)
            continue
        survivors.append((artifact_path, manifest_path, manifest, size))

    total = sum(size for _, _, _, size in survivors)
    if total <= limit:
        return {"removed": removed, "bytes_removed": bytes_removed, "bytes": total, "limit": limit}

    survivors.sort(key=lambda item: float(item[2].get("last_accessed_at") or item[2].get("created_at") or 0))
    for artifact_path, manifest_path, _manifest, size in survivors:
        if total <= limit:
            break
        total -= size
        bytes_removed += size
        removed += 1
        shutil.rmtree(manifest_path.parent, ignore_errors=True)

    return {"removed": removed, "bytes_removed": bytes_removed, "bytes": total, "limit": limit}


__all__ = [
    "CachedDownload",
    "album_cache_ttl_seconds",
    "album_download_cache_key",
    "download_cache_lock",
    "get_cached_download",
    "prune_download_cache",
    "safe_download_filename",
    "store_cached_download",
    "track_cache_ttl_seconds",
    "track_download_cache_key",
]
