"""Helpers for acquisition-task identity and idempotent queueing."""

from __future__ import annotations

from urllib.parse import urlparse


def infer_tidal_entity_type(url: str, content_type: str | None = None) -> str:
    explicit = (content_type or "").strip().lower()
    if explicit in {"track", "album", "artist", "playlist"}:
        return explicit

    path = urlparse((url or "").strip()).path.lower()
    if "/artist/" in path:
        return "artist"
    if "/track/" in path:
        return "track"
    if "/playlist/" in path:
        return "playlist"
    return "album"


def build_tidal_download_params(
    *,
    url: str,
    quality: str,
    download_id: int | None = None,
    content_type: str | None = None,
    artist: str = "",
    album: str = "",
    cover_url: str = "",
    upgrade_album_id: int | None = None,
    new_release_id: int | None = None,
) -> dict:
    params = {
        "url": url.strip(),
        "quality": quality,
        "entity_type": infer_tidal_entity_type(url, content_type),
        "artist": artist.strip(),
        "album": album.strip(),
    }
    if download_id:
        params["download_id"] = download_id
    if cover_url:
        params["cover_url"] = cover_url
    if upgrade_album_id:
        params["upgrade_album_id"] = upgrade_album_id
    if new_release_id:
        params["new_release_id"] = new_release_id
    return params


def tidal_download_dedup_key(params: dict) -> str:
    entity_type = str(params.get("entity_type") or infer_tidal_entity_type(str(params.get("url") or ""))).lower()
    url = str(params.get("url") or "").strip().lower()
    quality = str(params.get("quality") or "max").strip().lower()
    artist = str(params.get("artist") or "").strip().lower()
    album = str(params.get("album") or "").strip().lower()
    return f"tidal:{entity_type}:{url}:{quality}:{artist}:{album}"


def build_soulseek_download_params(
    *,
    username: str,
    artist: str,
    album: str,
    files: list[str],
    file_count: int,
    find_alternate: bool = False,
    upgrade_album_id: int | None = None,
) -> dict:
    params = {
        "username": (username or "unknown").strip(),
        "artist": artist.strip(),
        "album": album.strip(),
        "entity_type": "album",
        "files": list(files),
        "file_count": int(file_count),
        "find_alternate": bool(find_alternate),
    }
    if upgrade_album_id:
        params["upgrade_album_id"] = upgrade_album_id
    return params


def soulseek_download_dedup_key(params: dict) -> str:
    username = str(params.get("username") or "unknown").strip().lower()
    artist = str(params.get("artist") or "").strip().lower()
    album = str(params.get("album") or "").strip().lower()
    alternate = "alternate" if params.get("find_alternate") else "direct"
    files = sorted(str(item).strip().lower() for item in (params.get("files") or []))
    return f"soulseek:album:{username}:{artist}:{album}:{alternate}:{'|'.join(files)}"
