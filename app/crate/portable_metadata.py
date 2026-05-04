from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
from copy import deepcopy
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any


PORTABLE_SCHEMA_VERSION = 1
TAG_SCHEMA_VERSION = "1"
_ARTWORK_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
_ARTWORK_NAMES = {"cover", "folder", "front", "album", "artwork"}


def _json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _tag_value(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _identity_tags(
    *,
    artist_uid: Any,
    album_uid: Any,
    track_uid: Any,
    audio_fingerprint: Any = None,
    audio_fingerprint_source: Any = None,
) -> dict[str, str]:
    raw = {
        "crate_schema_version": TAG_SCHEMA_VERSION,
        "crate_artist_uid": artist_uid,
        "crate_album_uid": album_uid,
        "crate_track_uid": track_uid,
        "crate_audio_fingerprint": audio_fingerprint,
        "crate_audio_fingerprint_source": audio_fingerprint_source,
    }
    return {key: text for key, value in raw.items() if (text := _tag_value(value)) is not None}


def _find_artwork_files(album_dir: Path) -> list[str]:
    if not album_dir.is_dir():
        return []
    matches: list[str] = []
    for child in album_dir.iterdir():
        if not child.is_file() or child.suffix.lower() not in _ARTWORK_EXTENSIONS:
            continue
        stem = child.stem.lower().strip()
        if stem in _ARTWORK_NAMES or stem.startswith("cover"):
            matches.append(child.name)
    return sorted(matches)


def _sidecar_payload(album_payload: dict[str, Any], album_dir: Path) -> dict[str, Any]:
    payload = dict(album_payload)
    album = dict(payload.get("album") or {})
    album["artwork_files"] = _find_artwork_files(album_dir)
    payload["album"] = album
    payload["schema_version"] = PORTABLE_SCHEMA_VERSION
    payload["generated_at"] = datetime.now(timezone.utc).isoformat()
    return payload


def write_album_sidecar(album_payload: dict[str, Any]) -> Path:
    album = album_payload.get("album") or {}
    album_path = album.get("path")
    if not album_path:
        raise ValueError("album payload does not include a path")

    album_dir = Path(str(album_path))
    sidecar_dir = album_dir / ".crate"
    sidecar_dir.mkdir(parents=True, exist_ok=True)
    sidecar_path = sidecar_dir / "album.json"
    payload = _sidecar_payload(album_payload, album_dir)

    fd, tmp_name = tempfile.mkstemp(prefix="album.", suffix=".json.tmp", dir=sidecar_dir)
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True, default=_json_default)
            handle.write("\n")
        tmp_path.replace(sidecar_path)
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise
    return sidecar_path


def _write_mp4_tags(path: Path, tags: dict[str, str]) -> None:
    from mutagen.mp4 import MP4, MP4FreeForm

    try:
        from mutagen.mp4 import AtomDataType
        dataformat = AtomDataType.UTF8
    except Exception:
        dataformat = 1

    audio = MP4(str(path))
    for key, value in tags.items():
        if key == "lyrics":
            audio["\xa9lyr"] = [value]
            continue
        audio[f"----:com.crate:{key}"] = [MP4FreeForm(value.encode("utf-8"), dataformat=dataformat)]
    audio.save()


def _write_mp3_tags(path: Path, tags: dict[str, str]) -> None:
    from mutagen.id3 import TXXX, USLT
    from mutagen.mp3 import MP3

    audio = MP3(str(path))
    if audio.tags is None:
        audio.add_tags()
    for key, value in tags.items():
        if key == "lyrics":
            audio.tags.delall("USLT")
            audio.tags.add(USLT(encoding=3, lang="eng", desc="", text=value))
            continue
        audio.tags.delall(f"TXXX:{key}")
        audio.tags.add(TXXX(encoding=3, desc=key, text=[value]))
    audio.save()


def _write_mapping_tags(path: Path, tags: dict[str, str]) -> None:
    import mutagen

    audio = mutagen.File(str(path))
    if audio is None:
        raise ValueError("unsupported audio file")
    for key, value in tags.items():
        audio[key] = value
    audio.save()


def _write_tags_for_path(path: Path, tags: dict[str, str]) -> None:
    suffix = path.suffix.lower()
    if suffix in {".m4a", ".mp4", ".aac", ".alac"}:
        _write_mp4_tags(path, tags)
    elif suffix == ".mp3":
        _write_mp3_tags(path, tags)
    else:
        _write_mapping_tags(path, tags)


def _image_mime(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".png":
        return "image/png"
    if suffix == ".webp":
        return "image/webp"
    return "image/jpeg"


def find_album_artwork_file(album_dir: str | Path, names: list[str] | None = None) -> Path | None:
    root = Path(str(album_dir))
    if not root.is_dir():
        return None
    candidates = names or _find_artwork_files(root)
    for name in candidates:
        path = root / name
        if path.is_file() and path.suffix.lower() in _ARTWORK_EXTENSIONS:
            return path
    return None


def _embed_mp4_artwork(path: Path, artwork_path: Path) -> None:
    from mutagen.mp4 import MP4, MP4Cover

    audio = MP4(str(path))
    suffix = artwork_path.suffix.lower()
    if suffix == ".png":
        image_data = artwork_path.read_bytes()
        image_format = MP4Cover.FORMAT_PNG
    elif suffix in {".jpg", ".jpeg"}:
        image_data = artwork_path.read_bytes()
        image_format = MP4Cover.FORMAT_JPEG
    else:
        from PIL import Image

        with Image.open(artwork_path) as image:
            if image.mode not in {"RGB", "L"}:
                image = image.convert("RGB")
            buffer = BytesIO()
            image.save(buffer, format="JPEG", quality=92)
        image_data = buffer.getvalue()
        image_format = MP4Cover.FORMAT_JPEG
    audio["covr"] = [MP4Cover(image_data, imageformat=image_format)]
    audio.save()


def _embed_mp3_artwork(path: Path, artwork_path: Path) -> None:
    from mutagen.id3 import APIC
    from mutagen.mp3 import MP3

    audio = MP3(str(path))
    if audio.tags is None:
        audio.add_tags()
    audio.tags.delall("APIC")
    audio.tags.add(
        APIC(
            encoding=3,
            mime=_image_mime(artwork_path),
            type=3,
            desc="Cover",
            data=artwork_path.read_bytes(),
        )
    )
    audio.save()


def _embed_flac_artwork(path: Path, artwork_path: Path) -> None:
    from mutagen.flac import FLAC, Picture

    audio = FLAC(str(path))
    picture = Picture()
    picture.type = 3
    picture.mime = _image_mime(artwork_path)
    picture.desc = "Cover"
    picture.data = artwork_path.read_bytes()
    audio.clear_pictures()
    audio.add_picture(picture)
    audio.save()


def _embed_artwork_for_path(path: Path, artwork_path: str | Path | None) -> bool:
    if not artwork_path:
        return False
    artwork = Path(str(artwork_path))
    if not artwork.is_file():
        return False
    suffix = path.suffix.lower()
    if suffix in {".m4a", ".mp4", ".aac", ".alac"}:
        _embed_mp4_artwork(path, artwork)
        return True
    elif suffix == ".mp3":
        _embed_mp3_artwork(path, artwork)
        return True
    elif suffix == ".flac":
        _embed_flac_artwork(path, artwork)
        return True
    return False


def write_track_identity_tags(
    track_path: str | Path,
    *,
    artist_uid: Any,
    album_uid: Any,
    track_uid: Any,
    audio_fingerprint: Any = None,
    audio_fingerprint_source: Any = None,
) -> dict[str, Any]:
    path = Path(str(track_path))
    if not path.exists():
        return {"written": False, "path": str(path), "error": "file not found"}

    tags = _identity_tags(
        artist_uid=artist_uid,
        album_uid=album_uid,
        track_uid=track_uid,
        audio_fingerprint=audio_fingerprint,
        audio_fingerprint_source=audio_fingerprint_source,
    )
    if not tags:
        return {"written": False, "path": str(path), "error": "no identity tags to write"}

    try:
        _write_tags_for_path(path, tags)
    except Exception as exc:
        return {"written": False, "path": str(path), "error": str(exc)[:500]}
    return {"written": True, "path": str(path), "tags": sorted(tags)}


def _rich_tags(
    *,
    artist_uid: Any,
    album_uid: Any,
    track_payload: dict[str, Any],
) -> dict[str, str]:
    tags = _identity_tags(
        artist_uid=artist_uid,
        album_uid=album_uid,
        track_uid=track_payload.get("entity_uid"),
        audio_fingerprint=track_payload.get("audio_fingerprint"),
        audio_fingerprint_source=track_payload.get("audio_fingerprint_source"),
    )
    lyrics = track_payload.get("lyrics") or {}
    analysis = track_payload.get("analysis") or {}
    bliss = track_payload.get("bliss") or {}
    extras = {
        "crate_plain_lyrics": lyrics.get("plain"),
        "crate_synced_lyrics": lyrics.get("synced"),
        "lyrics": lyrics.get("plain"),
        "unsyncedlyrics": lyrics.get("plain"),
        "syncedlyrics": lyrics.get("synced"),
        "crate_analysis_json": json.dumps(analysis, ensure_ascii=False, sort_keys=True, default=_json_default)
        if analysis
        else None,
        "crate_bliss_vector": ",".join(str(value) for value in (bliss.get("vector") or []))
        if bliss.get("vector")
        else None,
    }
    tags.update({key: text for key, value in extras.items() if (text := _tag_value(value)) is not None})
    return tags


def write_track_rich_tags(
    track_path: str | Path,
    *,
    artist_uid: Any,
    album_uid: Any,
    track_payload: dict[str, Any],
    artwork_path: str | Path | None = None,
) -> dict[str, Any]:
    path = Path(str(track_path))
    if not path.exists():
        return {"written": False, "path": str(path), "error": "file not found"}

    tags = _rich_tags(artist_uid=artist_uid, album_uid=album_uid, track_payload=track_payload)
    if not tags:
        return {"written": False, "path": str(path), "error": "no tags to write"}

    try:
        _write_tags_for_path(path, tags)
        artwork_embedded = False
        artwork_error = None
        if artwork_path:
            try:
                artwork_embedded = _embed_artwork_for_path(path, artwork_path)
            except Exception as exc:
                artwork_error = str(exc)[:500]
    except Exception as exc:
        return {"written": False, "path": str(path), "error": str(exc)[:500]}
    result = {"written": True, "path": str(path), "tags": sorted(tags), "artwork_embedded": artwork_embedded}
    if artwork_error:
        result["artwork_error"] = artwork_error
    return result


def write_album_portable_metadata(
    album_payload: dict[str, Any],
    *,
    write_audio_tags: bool = True,
    write_sidecars: bool = True,
) -> dict[str, Any]:
    artist_uid = (album_payload.get("artist") or {}).get("entity_uid")
    album_uid = (album_payload.get("album") or {}).get("entity_uid")
    result: dict[str, Any] = {
        "album_id": (album_payload.get("album") or {}).get("id"),
        "album_entity_uid": album_uid,
        "sidecar_path": None,
        "tracks": 0,
        "tags_written": 0,
        "tag_errors": [],
    }

    if write_sidecars:
        result["sidecar_path"] = str(write_album_sidecar(album_payload))

    if not write_audio_tags:
        result["tracks"] = len(album_payload.get("tracks") or [])
        return result

    for track in album_payload.get("tracks") or []:
        result["tracks"] += 1
        tag_result = write_track_identity_tags(
            track.get("path"),
            artist_uid=artist_uid,
            album_uid=album_uid,
            track_uid=track.get("entity_uid"),
            audio_fingerprint=track.get("audio_fingerprint"),
            audio_fingerprint_source=track.get("audio_fingerprint_source"),
        )
        if tag_result.get("written"):
            result["tags_written"] += 1
        elif tag_result.get("error"):
            result["tag_errors"].append(tag_result)

    return result


def iter_album_sidecars(root_path: str | Path, *, limit: int | None = None) -> list[Path]:
    root = Path(str(root_path))
    if not root.exists():
        return []
    sidecars: list[Path] = []
    for candidate in sorted(root.rglob("album.json")):
        if candidate.parent.name != ".crate":
            continue
        sidecars.append(candidate)
        if limit is not None and len(sidecars) >= limit:
            break
    return sidecars


def load_album_sidecar(sidecar_path: str | Path) -> dict[str, Any]:
    path = Path(str(sidecar_path))
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    album_dir = path.parent.parent
    album = dict(payload.get("album") or {})
    album["path"] = str(album_dir)
    payload["album"] = album
    payload["_sidecar_path"] = str(path)

    tracks = []
    for track_payload in payload.get("tracks") or []:
        track = dict(track_payload)
        relative_path = str(track.get("relative_path") or "").strip()
        if relative_path:
            track["path"] = str(album_dir / relative_path)
        elif track.get("filename"):
            track["path"] = str(album_dir / str(track["filename"]))
        tracks.append(track)
    payload["tracks"] = tracks
    return payload


_SAFE_SEGMENT_RE = re.compile(r"[^A-Za-z0-9._ -]+")


def _safe_segment(value: Any, fallback: str) -> str:
    text = str(value or "").strip() or fallback
    text = _SAFE_SEGMENT_RE.sub("_", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    return text or fallback


def _copy_artwork_files(source_album_dir: Path, export_album_dir: Path, names: list[str]) -> int:
    copied = 0
    for name in names:
        source = source_album_dir / name
        if not source.is_file():
            continue
        target = export_album_dir / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        copied += 1
    return copied


def export_album_rich_metadata(
    album_payload: dict[str, Any],
    *,
    export_root: str | Path,
    include_audio: bool = True,
    write_rich_tags: bool = True,
) -> dict[str, Any]:
    source_album = album_payload.get("album") or {}
    artist_payload = album_payload.get("artist") or {}
    artist_name = artist_payload.get("name") or source_album.get("artist") or "Unknown Artist"
    album_name = source_album.get("name") or source_album.get("tag_album") or "Unknown Album"
    export_album_dir = Path(str(export_root)) / _safe_segment(artist_name, "Unknown Artist") / _safe_segment(album_name, "Unknown Album")
    export_album_dir.mkdir(parents=True, exist_ok=True)

    export_payload = deepcopy(album_payload)
    export_album = dict(export_payload.get("album") or {})
    source_album_dir = Path(str(source_album.get("path") or ""))
    artwork_path = None
    if source_album_dir.is_dir():
        artwork_names = list(source_album.get("artwork_files") or _find_artwork_files(source_album_dir))
        artwork_copied = _copy_artwork_files(source_album_dir, export_album_dir, artwork_names)
        artwork_path = find_album_artwork_file(source_album_dir, artwork_names)
    else:
        artwork_copied = 0

    artist_uid = artist_payload.get("entity_uid")
    album_uid = source_album.get("entity_uid")
    tracks_exported = 0
    tag_errors: list[dict[str, Any]] = []
    exported_tracks: list[dict[str, Any]] = []
    for track_payload in export_payload.get("tracks") or []:
        track = dict(track_payload)
        source_path = Path(str(track.get("path") or ""))
        relative_path = str(track.get("relative_path") or source_path.name or track.get("filename") or "").strip()
        if include_audio:
            if not source_path.is_file():
                tag_errors.append({"path": str(source_path), "error": "file not found"})
                continue
            target_path = export_album_dir / relative_path
            target_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, target_path)
            track["path"] = str(target_path)
            track["relative_path"] = str(target_path.relative_to(export_album_dir))
            tracks_exported += 1
            if write_rich_tags:
                tag_result = write_track_rich_tags(
                    target_path,
                    artist_uid=artist_uid,
                    album_uid=album_uid,
                    track_payload=track,
                    artwork_path=artwork_path,
                )
                if not tag_result.get("written") and tag_result.get("error"):
                    tag_errors.append(tag_result)
                elif tag_result.get("artwork_error"):
                    tag_errors.append(tag_result)
        exported_tracks.append(track)

    export_album["path"] = str(export_album_dir)
    export_album["artwork_files"] = _find_artwork_files(export_album_dir)
    export_payload["album"] = export_album
    export_payload["tracks"] = exported_tracks
    sidecar_path = write_album_sidecar(export_payload)

    return {
        "album_id": source_album.get("id"),
        "album_entity_uid": album_uid,
        "export_path": str(export_album_dir),
        "sidecar_path": str(sidecar_path),
        "tracks": tracks_exported if include_audio else len(exported_tracks),
        "artwork_files": artwork_copied,
        "tag_errors": tag_errors,
    }


__all__ = [
    "PORTABLE_SCHEMA_VERSION",
    "TAG_SCHEMA_VERSION",
    "export_album_rich_metadata",
    "find_album_artwork_file",
    "iter_album_sidecars",
    "load_album_sidecar",
    "write_album_portable_metadata",
    "write_album_sidecar",
    "write_track_identity_tags",
    "write_track_rich_tags",
]
