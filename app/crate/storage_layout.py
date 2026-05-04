from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any, Mapping


def artist_dir(library_root: str | Path, artist_entity_uid: str) -> Path:
    return Path(library_root) / str(artist_entity_uid)


def album_dir(library_root: str | Path, artist_entity_uid: str, album_entity_uid: str) -> Path:
    return artist_dir(library_root, artist_entity_uid) / str(album_entity_uid)


def track_path(
    library_root: str | Path,
    artist_entity_uid: str,
    album_entity_uid: str,
    track_entity_uid: str,
    extension: str,
) -> Path:
    suffix = extension if extension.startswith(".") else f".{extension}"
    return album_dir(library_root, artist_entity_uid, album_entity_uid) / f"{track_entity_uid}{suffix.lower()}"


def is_storage_v2_artist_dir(path: str | Path) -> bool:
    candidate = Path(path)
    return candidate.is_dir() and len(candidate.parts) >= 1


def looks_like_entity_uid(value: str | None) -> bool:
    if not value:
        return False
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def canonical_entity_uid(value: Any) -> str | None:
    candidate = str(value or "").strip()
    return candidate if looks_like_entity_uid(candidate) else None


def entity_uid_for(record: Mapping[str, Any] | None, *keys: str) -> str | None:
    if not record:
        return None
    candidate_keys = keys or ("entity_uid",)
    for key in candidate_keys:
        uid = canonical_entity_uid(record.get(key))
        if uid:
            return uid
    return None


def resolve_artist_dir(
    library_root: str | Path,
    artist: dict | None = None,
    *,
    fallback_name: str | None = None,
    existing_only: bool = False,
) -> Path | None:
    root = Path(library_root)
    candidates: list[Path] = []

    if artist:
        folder_name = artist.get("folder_name")
        entity_uid = entity_uid_for(artist, "entity_uid")
        name = artist.get("name")
        if folder_name:
            candidates.append(root / str(folder_name))
        if entity_uid:
            candidate = artist_dir(root, str(entity_uid))
            if candidate not in candidates:
                candidates.append(candidate)
        if name:
            candidate = root / str(name)
            if candidate not in candidates:
                candidates.append(candidate)

    if fallback_name:
        candidate = root / str(fallback_name)
        if candidate not in candidates:
            candidates.append(candidate)

    if existing_only:
        for candidate in candidates:
            if candidate.is_dir():
                return candidate
        return None

    return candidates[0] if candidates else None


def resolve_album_dir(
    library_root: str | Path,
    album: dict | None,
    *,
    artist: dict | None = None,
) -> Path | None:
    if not album:
        return None

    stored_path = album.get("path")
    if stored_path:
        return Path(stored_path)

    artist_uid = entity_uid_for(artist, "entity_uid") if artist else None
    album_uid = entity_uid_for(album, "entity_uid")
    if artist_uid and album_uid:
        return album_dir(library_root, str(artist_uid), str(album_uid))

    return None
