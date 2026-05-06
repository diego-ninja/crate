"""Shadow integration for Crate's native Rust scanner."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Any

from crate import crate_cli
from crate.storage_layout import canonical_entity_uid

log = logging.getLogger(__name__)

DEFAULT_AUDIO_EXTENSIONS = ("flac", "mp3", "m4a", "ogg", "opus", "wav")


def _env_enabled(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def shadow_enabled(config: dict | None = None) -> bool:
    if config and "native_scan_shadow" in config:
        return bool(config.get("native_scan_shadow"))
    return _env_enabled("CRATE_NATIVE_SCAN_SHADOW", False)


def diff_shadow_enabled(config: dict | None = None) -> bool:
    if config and "native_scan_diff_shadow" in config:
        return bool(config.get("native_scan_diff_shadow"))
    return _env_enabled("CRATE_NATIVE_SCAN_DIFF_SHADOW", False)


def diff_skip_unchanged_enabled(config: dict | None = None) -> bool:
    if config and "native_scan_diff_skip_unchanged" in config:
        return bool(config.get("native_scan_diff_skip_unchanged"))
    if config and str(config.get("native_scan_diff_source") or "").lower() in {"skip", "prefer", "native"}:
        return True
    source = os.environ.get("CRATE_NATIVE_SCAN_DIFF_SOURCE", "").strip().lower()
    return source in {"skip", "prefer", "native"} or _env_enabled("CRATE_NATIVE_SCAN_DIFF_SKIP_UNCHANGED", False)


def diff_compare_enabled(config: dict | None = None) -> bool:
    return diff_shadow_enabled(config) or diff_skip_unchanged_enabled(config)


def normalize_extensions(extensions: set[str] | list[str] | tuple[str, ...] | None) -> str:
    values = extensions or DEFAULT_AUDIO_EXTENSIONS
    normalized = sorted(
        {
            str(ext).strip().lower().removeprefix(".")
            for ext in values
            if str(ext).strip()
        }
    )
    return ",".join(normalized)


def _extension_set(extensions: str) -> set[str]:
    return {
        ext.strip().lower().removeprefix(".")
        for ext in extensions.split(",")
        if ext.strip()
    }


def _has_hidden_component(relative_path: Path) -> bool:
    return any(part.startswith(".") for part in relative_path.parts)


def _album_structure(root: Path, path: Path) -> tuple[str, Path] | None:
    try:
        rel = path.resolve().relative_to(root.resolve())
    except ValueError:
        return None

    if _has_hidden_component(rel):
        return None

    parts = rel.parts
    if len(parts) == 1:
        return root.name, root.resolve()
    if len(parts) == 2:
        return parts[0], (root / parts[0]).resolve()
    if len(parts) >= 3 and len(parts[0]) == 4 and parts[0].isdigit():
        return parts[1], (root / parts[0] / parts[1]).resolve()
    if len(parts) >= 3:
        return parts[1], (root / parts[0] / parts[1]).resolve()
    return None


def discover_python_audio_paths(root: Path, extensions: str) -> set[str]:
    suffixes = _extension_set(extensions)
    candidates = sorted(
        path
        for path in root.rglob("*")
        if path.is_file()
        and path.suffix.lower().removeprefix(".") in suffixes
        and _album_structure(root, path) is not None
    )

    albums_with_flac = {
        album_path
        for path in candidates
        if path.suffix.lower() == ".flac"
        for _album_name, album_path in [_album_structure(root, path)]
        if album_path is not None
    }

    selected = [
        path
        for path in candidates
        if not (path.suffix.lower() == ".m4a" and _album_structure(root, path)[1] in albums_with_flac)
    ]
    return {path.resolve().relative_to(root.resolve()).as_posix() for path in selected}


def flatten_native_paths(root: Path, payload: dict[str, Any]) -> set[str]:
    paths: set[str] = set()
    for artist in payload.get("artists") or []:
        for album in artist.get("albums") or []:
            for track in album.get("tracks") or []:
                raw = track.get("path")
                if not raw:
                    continue
                path = Path(raw)
                try:
                    paths.add(path.resolve().relative_to(root.resolve()).as_posix())
                except ValueError:
                    paths.add(str(raw))
    return paths


def compare_native_scan_file_set(
    root: Path,
    extensions: set[str] | list[str] | tuple[str, ...] | None,
    *,
    max_items: int = 25,
) -> dict[str, Any]:
    """Compare native scan discovery against the Python scanner semantics."""
    extension_arg = normalize_extensions(extensions)
    started = time.perf_counter()
    native_payload = crate_cli.run_scan(
        str(root),
        hash=False,
        covers=False,
        extensions=extension_arg,
    )
    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
    if not native_payload:
        return {
            "available": False,
            "root": str(root),
            "extensions": extension_arg,
            "elapsed_ms": elapsed_ms,
            "reason": "crate-cli scan unavailable or failed",
        }

    python_paths = discover_python_audio_paths(root, extension_arg)
    native_paths = flatten_native_paths(root, native_payload)
    missing = sorted(python_paths - native_paths)
    extra = sorted(native_paths - python_paths)

    return {
        "available": True,
        "root": str(root),
        "extensions": extension_arg,
        "elapsed_ms": elapsed_ms,
        "python_tracks": len(python_paths),
        "native_tracks": len(native_paths),
        "common_tracks": len(python_paths & native_paths),
        "missing_in_native": missing[:max_items],
        "extra_in_native": extra[:max_items],
        "missing_count": len(missing),
        "extra_count": len(extra),
        "ok": not missing and not extra,
    }


def maybe_compare_native_scan_file_set(
    root: Path,
    extensions: set[str] | list[str] | tuple[str, ...] | None,
    config: dict | None = None,
) -> dict[str, Any] | None:
    if not shadow_enabled(config):
        return None
    try:
        return compare_native_scan_file_set(root, extensions)
    except Exception:
        log.exception("Native scan shadow compare failed for %s", root)
        return {"available": False, "root": str(root), "reason": "shadow compare failed"}


def _snapshot_dir(config: dict | None = None) -> Path:
    configured = None
    if config:
        configured = config.get("native_scan_snapshot_dir")
    configured = configured or os.environ.get("CRATE_NATIVE_SCAN_SNAPSHOT_DIR")
    if configured:
        return Path(str(configured))
    return Path(os.environ.get("DATA_DIR", "/data")) / "native-scan-snapshots"


def _snapshot_file(root: Path, extensions: str, config: dict | None = None) -> Path:
    key = f"{root.resolve()}|{extensions}|v1"
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return _snapshot_dir(config) / f"{digest}.json"


def _trim_diff_payload(diff: dict[str, Any], max_items: int) -> dict[str, Any]:
    trimmed = dict(diff)
    for key in ("added", "removed", "moved", "changed"):
        value = trimmed.get(key)
        if isinstance(value, list):
            trimmed[key] = value[:max_items]
            trimmed[f"{key}_truncated"] = len(value) > max_items
    return trimmed


def update_native_scan_diff_snapshot(
    root: Path,
    extensions: set[str] | list[str] | tuple[str, ...] | None,
    config: dict | None = None,
    *,
    max_items: int = 25,
) -> dict[str, Any]:
    """Persist a native scan snapshot and diff it against the previous run."""
    extension_arg = normalize_extensions(extensions)
    snapshot_path = _snapshot_file(root, extension_arg, config)
    previous_path = snapshot_path if snapshot_path.exists() else None

    started = time.perf_counter()
    native_payload = crate_cli.run_scan(
        str(root),
        hash=False,
        covers=True,
        extensions=extension_arg,
    )
    scan_elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
    if not native_payload:
        return {
            "available": False,
            "root": str(root),
            "extensions": extension_arg,
            "elapsed_ms": scan_elapsed_ms,
            "reason": "crate-cli scan unavailable or failed",
        }

    snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=snapshot_path.parent, prefix=f".{snapshot_path.name}.", suffix=".current", delete=False) as tmp:
        json.dump(native_payload, tmp, separators=(",", ":"), sort_keys=True)
        tmp.write("\n")
        current_path = Path(tmp.name)

    diff_payload = None
    diff_elapsed_ms = 0.0
    try:
        if previous_path:
            diff_started = time.perf_counter()
            raw_diff = crate_cli.run_diff(str(previous_path), str(current_path))
            diff_elapsed_ms = round((time.perf_counter() - diff_started) * 1000, 2)
            diff_payload = _trim_diff_payload(raw_diff, max_items) if raw_diff else None
        current_path.replace(snapshot_path)
    finally:
        if current_path.exists():
            try:
                current_path.unlink()
            except OSError:
                pass

    total_files = int(native_payload.get("total_files") or 0)
    total_size = int(native_payload.get("total_size") or 0)
    summary = {
        "available": True,
        "root": str(root),
        "extensions": extension_arg,
        "snapshot": str(snapshot_path),
        "tracks": total_files,
        "total_size": total_size,
        "scan_elapsed_ms": scan_elapsed_ms,
        "diff_elapsed_ms": diff_elapsed_ms,
        "elapsed_ms": round(scan_elapsed_ms + diff_elapsed_ms, 2),
        "initialized": previous_path is None,
        "has_previous": previous_path is not None,
    }
    if diff_payload is not None:
        summary["diff"] = diff_payload
    elif previous_path is not None:
        summary["reason"] = "crate-cli diff unavailable or failed"
    return summary


def maybe_update_native_scan_diff_snapshot(
    root: Path,
    extensions: set[str] | list[str] | tuple[str, ...] | None,
    config: dict | None = None,
) -> dict[str, Any] | None:
    if not diff_compare_enabled(config):
        return None
    try:
        return update_native_scan_diff_snapshot(root, extensions, config)
    except Exception:
        log.exception("Native scan diff shadow failed for %s", root)
        return {"available": False, "root": str(root), "reason": "diff shadow failed"}


def native_scan_diff_is_unchanged(summary: dict[str, Any] | None) -> bool:
    if not summary or not summary.get("available"):
        return False
    if summary.get("initialized") or not summary.get("has_previous"):
        return False
    diff = summary.get("diff")
    if not isinstance(diff, dict):
        return False
    return all(
        int(diff.get(key) or 0) == 0
        for key in ("added_count", "removed_count", "moved_count", "changed_count")
    )


def payload_shadow_enabled(config: dict | None = None) -> bool:
    if config and "native_scan_payload_shadow" in config:
        return bool(config.get("native_scan_payload_shadow"))
    return _env_enabled("CRATE_NATIVE_SCAN_PAYLOAD_SHADOW", False)


def payload_prefer_enabled(config: dict | None = None) -> bool:
    if config and "native_scan_payload_prefer" in config:
        return bool(config.get("native_scan_payload_prefer"))
    if config and str(config.get("native_scan_payload_source") or "").lower() in {"native", "prefer"}:
        return True
    source = os.environ.get("CRATE_NATIVE_SCAN_PAYLOAD_SOURCE", "").strip().lower()
    return source in {"native", "prefer"} or _env_enabled("CRATE_NATIVE_SCAN_PAYLOAD_PREFER", False)


def payload_compare_enabled(config: dict | None = None) -> bool:
    return payload_shadow_enabled(config) or payload_prefer_enabled(config)


def _empty_to_none(value: Any) -> Any:
    if value == "":
        return None
    return value


def _first_present(rows: list[dict[str, Any]], key: str) -> Any:
    for row in rows:
        value = _empty_to_none(row.get(key))
        if value is not None:
            return value
    return None


def _duration_from_ms(value: Any) -> float:
    try:
        return round(float(value or 0) / 1000.0, 3)
    except (TypeError, ValueError):
        return 0.0


def _native_track_payload(track: dict[str, Any], fallback_artist: str, fallback_album: str) -> dict[str, Any]:
    path = Path(track.get("path") or "")
    tags = track.get("tags") or {}
    identity = tags.get("crate_identity") or {}
    crate_track_uid = identity.get("crate_track_uid")
    artist = _empty_to_none(tags.get("artist")) or _empty_to_none(tags.get("album_artist")) or fallback_artist
    album = _empty_to_none(tags.get("album")) or fallback_album
    album_artist = _empty_to_none(tags.get("album_artist")) or artist
    return {
        "artist": artist,
        "album": album,
        "entity_uid": crate_track_uid or canonical_entity_uid(path.stem),
        "filename": track.get("filename") or path.name,
        "title": _empty_to_none(tags.get("title")),
        "track_number": tags.get("track_number"),
        "disc_number": tags.get("disc_number") or 1,
        "format": tags.get("format") or path.suffix.lower().removeprefix("."),
        "bitrate": tags.get("bitrate"),
        "sample_rate": tags.get("sample_rate"),
        "bit_depth": tags.get("bit_depth"),
        "duration": _duration_from_ms(tags.get("duration_ms")),
        "size": track.get("size") or 0,
        "year": _empty_to_none(tags.get("year")),
        "genre": _empty_to_none(tags.get("genre")),
        "albumartist": album_artist,
        "musicbrainz_albumid": _empty_to_none(tags.get("musicbrainz_album_id")),
        "musicbrainz_trackid": _empty_to_none(tags.get("musicbrainz_track_id")),
        "audio_fingerprint": identity.get("crate_audio_fingerprint"),
        "audio_fingerprint_source": identity.get("crate_audio_fingerprint_source"),
        "path": str(path),
        "_crate_identity_tagged": bool(crate_track_uid),
    }


def _select_native_album(album_dir: Path, payload: dict[str, Any]) -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []
    for artist in payload.get("artists") or []:
        for album in artist.get("albums") or []:
            candidates.append(album)
            raw_path = album.get("path")
            if not raw_path:
                continue
            try:
                if Path(raw_path).resolve() == album_dir.resolve():
                    return album
            except OSError:
                continue
    return candidates[0] if len(candidates) == 1 else None


def build_native_album_projection(
    album_dir: Path,
    artist_name: str,
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    native_album = _select_native_album(album_dir, payload)
    if not native_album:
        return None

    fallback_album = native_album.get("name") or album_dir.name
    tracks = [
        _native_track_payload(track, fallback_artist=artist_name, fallback_album=fallback_album)
        for track in native_album.get("tracks") or []
    ]
    formats = sorted({track.get("format") for track in tracks if track.get("format")})
    total_duration = sum(float(track.get("duration") or 0) for track in tracks)
    total_size = sum(int(track.get("size") or 0) for track in tracks)
    tag_album = _first_present(tracks, "album")
    album_name = tag_album or native_album.get("name") or album_dir.name

    return {
        "album_payload": {
            "name": album_name,
            "entity_uid": canonical_entity_uid(album_dir.name),
            "path": str(album_dir),
            "track_count": len(tracks),
            "total_size": total_size,
            "total_duration": total_duration,
            "formats": formats,
            "year": _first_present(tracks, "year"),
            "genre": _first_present(tracks, "genre"),
            "has_cover": int(bool(native_album.get("has_cover") or native_album.get("has_embedded_art"))),
            "musicbrainz_albumid": _first_present(tracks, "musicbrainz_albumid"),
            "tag_album": tag_album,
        },
        "artist_payload": {
            "name": artist_name,
            "entity_uid": canonical_entity_uid(album_dir.parent.name),
        },
        "track_payloads": tracks,
    }


def _track_path_key(path: Any) -> str:
    try:
        return str(Path(str(path)).resolve())
    except OSError:
        return str(path)


def _display_path(album_dir: Path, path: Any) -> str:
    try:
        return Path(str(path)).resolve().relative_to(album_dir.resolve()).as_posix()
    except (OSError, ValueError):
        return str(path)


def _values_match(field: str, python_value: Any, native_value: Any, *, track_count: int = 1) -> bool:
    python_value = _empty_to_none(python_value)
    native_value = _empty_to_none(native_value)
    if python_value == native_value:
        return True
    if field in {"duration", "total_duration"} and python_value is not None and native_value is not None:
        tolerance = max(1.0, float(track_count)) if field == "total_duration" else 1.0
        return abs(float(python_value) - float(native_value)) <= tolerance
    if field == "bitrate" and python_value is not None and native_value is not None:
        return abs(int(python_value) - int(native_value)) <= 2000
    return False


def _lossy_format(value: Any) -> bool:
    return str(value or "").lower() in {"aac", "m4a", "mp3", "ogg", "opus"}


def compare_album_payloads(
    album_dir: Path,
    python_album_payload: dict[str, Any],
    python_track_payloads: list[dict[str, Any]],
    native_projection: dict[str, Any],
    *,
    max_items: int = 25,
) -> dict[str, Any]:
    native_album_payload = native_projection.get("album_payload") or {}
    native_track_payloads = native_projection.get("track_payloads") or []
    album_field_diffs: list[dict[str, Any]] = []
    track_field_diffs: list[dict[str, Any]] = []

    album_fields = (
        "name",
        "track_count",
        "total_size",
        "total_duration",
        "formats",
        "year",
        "genre",
        "has_cover",
        "musicbrainz_albumid",
        "tag_album",
    )
    for field in album_fields:
        if not _values_match(
            field,
            python_album_payload.get(field),
            native_album_payload.get(field),
            track_count=int(python_album_payload.get("track_count") or 1),
        ):
            album_field_diffs.append({
                "field": field,
                "python": python_album_payload.get(field),
                "native": native_album_payload.get(field),
            })
            if len(album_field_diffs) >= max_items:
                break

    python_by_path = {_track_path_key(track.get("path")): track for track in python_track_payloads}
    native_by_path = {_track_path_key(track.get("path")): track for track in native_track_payloads}
    python_paths = set(python_by_path)
    native_paths = set(native_by_path)

    track_fields = (
        "filename",
        "title",
        "artist",
        "album",
        "track_number",
        "disc_number",
        "format",
        "bitrate",
        "sample_rate",
        "bit_depth",
        "duration",
        "size",
        "year",
        "genre",
        "albumartist",
        "musicbrainz_albumid",
        "musicbrainz_trackid",
    )
    for path in sorted(python_paths & native_paths):
        python_track = python_by_path[path]
        native_track = native_by_path[path]
        for field in track_fields:
            if (
                field == "bit_depth"
                and native_track.get(field) is None
                and _lossy_format(python_track.get("format") or native_track.get("format"))
            ):
                continue
            if not _values_match(field, python_track.get(field), native_track.get(field)):
                track_field_diffs.append({
                    "path": _display_path(album_dir, path),
                    "field": field,
                    "python": python_track.get(field),
                    "native": native_track.get(field),
                })
                if len(track_field_diffs) >= max_items:
                    break
        if len(track_field_diffs) >= max_items:
            break

    missing = sorted(_display_path(album_dir, path) for path in python_paths - native_paths)
    extra = sorted(_display_path(album_dir, path) for path in native_paths - python_paths)
    identity_overrides = [
        {
            "path": _display_path(album_dir, path),
            "python": python_by_path[path].get("entity_uid"),
            "native": native_by_path[path].get("entity_uid"),
        }
        for path in sorted(python_paths & native_paths)
        if native_by_path[path].get("_crate_identity_tagged")
        and native_by_path[path].get("entity_uid")
        and native_by_path[path].get("entity_uid") != python_by_path[path].get("entity_uid")
    ]

    return {
        "available": True,
        "root": str(album_dir),
        "python_tracks": len(python_track_payloads),
        "native_tracks": len(native_track_payloads),
        "common_tracks": len(python_paths & native_paths),
        "missing_in_native": missing[:max_items],
        "extra_in_native": extra[:max_items],
        "missing_count": len(missing),
        "extra_count": len(extra),
        "album_field_diffs": album_field_diffs,
        "track_field_diffs": track_field_diffs,
        "native_identity_overrides": identity_overrides[:max_items],
        "native_identity_override_count": len(identity_overrides),
        "ok": not missing and not extra and not album_field_diffs and not track_field_diffs,
    }


def _run_native_album_projection(
    album_dir: Path,
    artist_name: str,
    extensions: set[str] | list[str] | tuple[str, ...] | None,
) -> dict[str, Any]:
    extension_arg = normalize_extensions(extensions)
    started = time.perf_counter()
    native_payload = crate_cli.run_scan(
        str(album_dir),
        hash=False,
        covers=True,
        extensions=extension_arg,
    )
    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
    if not native_payload:
        return {
            "summary": {
                "available": False,
                "root": str(album_dir),
                "extensions": extension_arg,
                "elapsed_ms": elapsed_ms,
                "reason": "crate-cli scan unavailable or failed",
            },
            "projection": None,
        }

    native_projection = build_native_album_projection(album_dir, artist_name, native_payload)
    if not native_projection:
        return {
            "summary": {
                "available": False,
                "root": str(album_dir),
                "extensions": extension_arg,
                "elapsed_ms": elapsed_ms,
                "reason": "crate-cli scan returned no album projection",
            },
            "projection": None,
        }

    return {
        "summary": {
            "available": True,
            "root": str(album_dir),
            "extensions": extension_arg,
            "elapsed_ms": elapsed_ms,
        },
        "projection": native_projection,
    }


def compare_native_album_payload(
    album_dir: Path,
    artist_name: str,
    python_album_payload: dict[str, Any],
    python_track_payloads: list[dict[str, Any]],
    extensions: set[str] | list[str] | tuple[str, ...] | None,
    *,
    max_items: int = 25,
) -> dict[str, Any]:
    result = _run_native_album_projection(album_dir, artist_name, extensions)
    base_summary = result["summary"]
    native_projection = result.get("projection")
    if not native_projection:
        return base_summary

    summary = compare_album_payloads(
        album_dir,
        python_album_payload,
        python_track_payloads,
        native_projection,
        max_items=max_items,
    )
    summary.update({
        "extensions": base_summary["extensions"],
        "elapsed_ms": base_summary["elapsed_ms"],
    })
    return summary


def _public_track_payload(track: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in track.items() if not key.startswith("_")}


def adopt_native_album_projection(
    python_album_payload: dict[str, Any],
    native_projection: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    native_album = native_projection.get("album_payload") or {}
    adopted_album = dict(python_album_payload)
    for field in (
        "name",
        "track_count",
        "total_size",
        "total_duration",
        "formats",
        "year",
        "genre",
        "has_cover",
        "musicbrainz_albumid",
        "tag_album",
    ):
        if field in native_album:
            adopted_album[field] = native_album[field]

    # Operational DB fields stay owned by the Python sync loop.
    for field in ("entity_uid", "path", "dir_mtime"):
        if field in python_album_payload:
            adopted_album[field] = python_album_payload[field]

    adopted_tracks = [_public_track_payload(track) for track in native_projection.get("track_payloads") or []]
    return adopted_album, adopted_tracks


def maybe_prepare_native_album_payload(
    album_dir: Path,
    artist_name: str,
    python_album_payload: dict[str, Any],
    python_track_payloads: list[dict[str, Any]],
    extensions: set[str] | list[str] | tuple[str, ...] | None,
    config: dict | None = None,
) -> dict[str, Any] | None:
    if not payload_compare_enabled(config):
        return None
    try:
        result = _run_native_album_projection(album_dir, artist_name, extensions)
        summary = result["summary"]
        native_projection = result.get("projection")
        if native_projection:
            summary = compare_album_payloads(
                album_dir,
                python_album_payload,
                python_track_payloads,
                native_projection,
            )
            summary.update({
                "extensions": result["summary"]["extensions"],
                "elapsed_ms": result["summary"]["elapsed_ms"],
            })
        return {
            "summary": summary,
            "projection": native_projection,
            "prefer": payload_prefer_enabled(config),
        }
    except Exception:
        log.exception("Native album payload prepare failed for %s", album_dir)
        return {
            "summary": {"available": False, "root": str(album_dir), "reason": "payload prepare failed"},
            "projection": None,
            "prefer": payload_prefer_enabled(config),
        }


def maybe_compare_native_album_payload(
    album_dir: Path,
    artist_name: str,
    python_album_payload: dict[str, Any],
    python_track_payloads: list[dict[str, Any]],
    extensions: set[str] | list[str] | tuple[str, ...] | None,
    config: dict | None = None,
) -> dict[str, Any] | None:
    if not payload_shadow_enabled(config):
        return None
    prepared = maybe_prepare_native_album_payload(
        album_dir,
        artist_name,
        python_album_payload,
        python_track_payloads,
        extensions,
        config,
    )
    return prepared["summary"] if prepared else None
