from __future__ import annotations

import uuid
from pathlib import Path


def artist_dir(library_root: str | Path, artist_storage_id: str) -> Path:
    return Path(library_root) / str(artist_storage_id)


def album_dir(library_root: str | Path, artist_storage_id: str, album_storage_id: str) -> Path:
    return artist_dir(library_root, artist_storage_id) / str(album_storage_id)


def track_path(
    library_root: str | Path,
    artist_storage_id: str,
    album_storage_id: str,
    track_storage_id: str,
    extension: str,
) -> Path:
    suffix = extension if extension.startswith(".") else f".{extension}"
    return album_dir(library_root, artist_storage_id, album_storage_id) / f"{track_storage_id}{suffix.lower()}"


def is_storage_v2_artist_dir(path: str | Path) -> bool:
    candidate = Path(path)
    return candidate.is_dir() and len(candidate.parts) >= 1


def looks_like_storage_id(value: str | None) -> bool:
    if not value:
        return False
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, TypeError, AttributeError):
        return False


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
        storage_id = artist.get("storage_id")
        name = artist.get("name")
        if folder_name:
            candidates.append(root / str(folder_name))
        if storage_id:
            candidate = artist_dir(root, str(storage_id))
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

    if artist and artist.get("storage_id") and album.get("storage_id"):
        return album_dir(library_root, str(artist["storage_id"]), str(album["storage_id"]))

    return None
