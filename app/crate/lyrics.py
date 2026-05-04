from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any, Callable

import requests

from crate.db.repositories.lyrics import get_cached_lyrics, store_lyrics

log = logging.getLogger(__name__)

LYRICS_TTL_SECONDS = 86400 * 30


def _response_payload(payload: dict[str, Any] | None) -> dict[str, str | None]:
    if not payload:
        return {"syncedLyrics": None, "plainLyrics": None}
    return {
        "syncedLyrics": payload.get("syncedLyrics"),
        "plainLyrics": payload.get("plainLyrics"),
    }


def _lyrics_status_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    response = _response_payload(payload)
    has_synced = bool(response.get("syncedLyrics"))
    has_plain = bool(response.get("plainLyrics"))
    return {
        "status": "synced" if has_synced else "txt" if has_plain else "none",
        "found": bool(payload.get("found")) if payload else False,
        "has_plain": has_plain,
        "has_synced": has_synced,
        "provider": (payload.get("provider") if payload else None) or "lrclib",
        "updated_at": payload.get("updated_at") if payload else None,
    }


def fetch_and_store_lrclib_lyrics(
    artist: str,
    title: str,
    *,
    track_id: int | None = None,
    track_entity_uid: str | None = None,
) -> dict[str, Any]:
    resp = requests.get(
        "https://lrclib.net/api/get",
        params={"artist_name": artist.strip(), "track_name": title.strip()},
        timeout=10,
        headers={"User-Agent": "Crate/1.0"},
    )
    if resp.status_code == 404:
        return store_lyrics(
            artist,
            title,
            synced_lyrics=None,
            plain_lyrics=None,
            track_id=track_id,
            track_entity_uid=track_entity_uid,
            source_json={"status_code": resp.status_code},
            found=False,
        )
    if resp.status_code != 200:
        raise RuntimeError(f"lrclib returned HTTP {resp.status_code}")

    data = resp.json()
    return store_lyrics(
        artist,
        title,
        synced_lyrics=data.get("syncedLyrics"),
        plain_lyrics=data.get("plainLyrics"),
        track_id=track_id,
        track_entity_uid=track_entity_uid,
        source_json=data,
        found=bool(data.get("syncedLyrics") or data.get("plainLyrics")),
    )


def get_or_fetch_lyrics(
    artist: str,
    title: str,
    *,
    track_id: int | None = None,
    track_entity_uid: str | None = None,
    force: bool = False,
    max_age_seconds: int | None = LYRICS_TTL_SECONDS,
) -> dict[str, str | None]:
    if not force:
        cached = get_cached_lyrics(artist, title, max_age_seconds=max_age_seconds)
        if cached is not None:
            return _response_payload(cached)

    try:
        stored = fetch_and_store_lrclib_lyrics(
            artist,
            title,
            track_id=track_id,
            track_entity_uid=track_entity_uid,
        )
        return _response_payload(stored)
    except Exception:
        log.debug("Lyrics fetch failed for %s - %s", artist, title, exc_info=True)
        return {"syncedLyrics": None, "plainLyrics": None}


def _track_title(track: dict[str, Any]) -> str:
    title = str(track.get("title") or "").strip()
    if title:
        return title
    filename = str(track.get("filename") or track.get("path") or "").strip()
    return Path(filename).stem if filename else ""


def sync_lyrics_for_tracks(
    tracks: list[dict[str, Any]],
    *,
    force: bool = False,
    delay_seconds: float = 0.2,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
    cancel_callback: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    found = 0
    missing = 0
    skipped = 0
    errors = 0

    for index, track in enumerate(tracks, start=1):
        if cancel_callback and cancel_callback():
            break

        artist = str(track.get("artist") or "").strip()
        title = _track_title(track)
        if progress_callback:
            progress_callback(
                {
                    "event": "track_start",
                    "done": index - 1,
                    "index": index,
                    "total": len(tracks),
                    "artist": artist,
                    "album": track.get("album"),
                    "album_id": track.get("album_id"),
                    "title": title,
                    "track_id": track.get("id"),
                    "track_entity_uid": str(track["entity_uid"]) if track.get("entity_uid") else None,
                    "path": track.get("path"),
                }
            )

        if not artist or not title:
            skipped += 1
            if progress_callback:
                progress_callback(
                    {
                        "event": "track_done",
                        "done": index,
                        "index": index,
                        "total": len(tracks),
                        "artist": artist,
                        "album": track.get("album"),
                        "album_id": track.get("album_id"),
                        "title": title,
                        "track_id": track.get("id"),
                        "track_entity_uid": str(track["entity_uid"]) if track.get("entity_uid") else None,
                        "path": track.get("path"),
                        "status": "none",
                        "found": False,
                        "has_plain": False,
                        "has_synced": False,
                        "skipped": True,
                    }
                )
            continue

        try:
            cached = None if force else get_cached_lyrics(artist, title, max_age_seconds=LYRICS_TTL_SECONDS)
            if cached is not None:
                payload = _response_payload(cached)
                status_payload = _lyrics_status_payload(cached)
                source = "cache"
            else:
                stored = fetch_and_store_lrclib_lyrics(
                    artist,
                    title,
                    track_id=track.get("id"),
                    track_entity_uid=str(track["entity_uid"]) if track.get("entity_uid") else None,
                )
                payload = _response_payload(stored)
                status_payload = _lyrics_status_payload(stored)
                source = "lrclib"
            if payload.get("syncedLyrics") or payload.get("plainLyrics"):
                found += 1
            else:
                missing += 1
            if progress_callback:
                progress_callback(
                    {
                        "event": "track_done",
                        "done": index,
                        "index": index,
                        "total": len(tracks),
                        "artist": artist,
                        "album": track.get("album"),
                        "album_id": track.get("album_id"),
                        "title": title,
                        "track_id": track.get("id"),
                        "track_entity_uid": str(track["entity_uid"]) if track.get("entity_uid") else None,
                        "path": track.get("path"),
                        "source": source,
                        **status_payload,
                    }
                )
        except Exception:
            errors += 1
            log.debug("Lyrics sync failed for track %s", track.get("id"), exc_info=True)
            if progress_callback:
                progress_callback(
                    {
                        "event": "track_done",
                        "done": index,
                        "index": index,
                        "total": len(tracks),
                        "artist": artist,
                        "album": track.get("album"),
                        "album_id": track.get("album_id"),
                        "title": title,
                        "track_id": track.get("id"),
                        "track_entity_uid": str(track["entity_uid"]) if track.get("entity_uid") else None,
                        "path": track.get("path"),
                        "status": "none",
                        "found": False,
                        "has_plain": False,
                        "has_synced": False,
                        "error": True,
                    }
                )

        if delay_seconds > 0 and index < len(tracks):
            time.sleep(delay_seconds)

    if progress_callback:
        progress_callback({"event": "complete", "done": len(tracks), "total": len(tracks)})

    return {
        "tracks": len(tracks),
        "found": found,
        "missing": missing,
        "skipped": skipped,
        "errors": errors,
    }


__all__ = [
    "LYRICS_TTL_SECONDS",
    "fetch_and_store_lrclib_lyrics",
    "get_or_fetch_lyrics",
    "sync_lyrics_for_tracks",
]
