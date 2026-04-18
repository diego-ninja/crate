"""Compute popularity scores for artists, albums, and tracks using Last.fm data."""

import logging
import time

import requests

from crate.db.cache import get_setting
from crate.db.jobs.popularity import (
    get_albums_without_popularity,
    get_tracks_without_popularity,
    normalize_popularity_scores,
    update_album_lastfm,
    update_track_lastfm,
)

log = logging.getLogger(__name__)

LASTFM_BASE = "http://ws.audioscrobbler.com/2.0/"


def _api_key() -> str | None:
    import os
    return os.environ.get("LASTFM_APIKEY")


def _lastfm_get(method: str, **params) -> dict | None:
    key = _api_key()
    if not key:
        return None
    try:
        resp = requests.get(LASTFM_BASE, params={
            "method": method, "api_key": key, "format": "json", **params,
        }, timeout=10)
        if resp.status_code == 200:
            return resp.json()
    except Exception:
        pass
    return None


def _parse_int(val) -> int:
    try:
        return int(val)
    except (TypeError, ValueError):
        return 0


def compute_popularity(progress_callback=None) -> dict:
    """Fetch Last.fm play counts for all albums and tracks, then normalize to 0-100."""
    albums_fetched = 0
    tracks_fetched = 0

    # 1. Fetch album popularity from Last.fm (only albums without data)
    albums = get_albums_without_popularity()

    total_albums = len(albums)
    for i, album in enumerate(albums):
        artist = album["artist"]
        album_name = album.get("tag_album") or album["name"]
        # Strip year prefix
        import re
        album_name = re.sub(r"^\d{4}\s*-\s*", "", album_name)

        if progress_callback and i % 10 == 0:
            progress_callback({"phase": "albums", "done": i, "total": total_albums})

        data = _lastfm_get("album.getinfo", artist=artist, album=album_name, autocorrect=1)
        if data and "album" in data:
            info = data["album"]
            listeners = _parse_int(info.get("listeners", 0))
            playcount = _parse_int(info.get("playcount", 0))

            if listeners > 0 or playcount > 0:
                update_album_lastfm(album["id"], listeners, playcount)
                albums_fetched += 1

        time.sleep(0.25)  # Last.fm rate limit

    # 2. Fetch track popularity (sample: tracks from albums with listeners)
    tracks = get_tracks_without_popularity()

    total_tracks = len(tracks)
    for i, track in enumerate(tracks):
        if progress_callback and i % 20 == 0:
            progress_callback({"phase": "tracks", "done": i, "total": total_tracks})

        data = _lastfm_get("track.getinfo", artist=track["artist"], track=track["title"], autocorrect=1)
        if data and "track" in data:
            info = data["track"]
            listeners = _parse_int(info.get("listeners", 0))
            playcount = _parse_int(info.get("playcount", 0))

            if listeners > 0 or playcount > 0:
                update_track_lastfm(track["id"], listeners, playcount)
                tracks_fetched += 1

        time.sleep(0.2)

    # 3. Normalize to 0-100 within the library
    if progress_callback:
        progress_callback({"phase": "normalizing"})

    _normalize_popularity()

    return {
        "albums_fetched": albums_fetched,
        "tracks_fetched": tracks_fetched,
        "total_albums": total_albums,
        "total_tracks": total_tracks,
    }


def _normalize_popularity():
    """Normalize lastfm_listeners to a 0-100 popularity score relative to library max."""
    normalize_popularity_scores()
