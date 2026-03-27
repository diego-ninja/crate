"""Compute popularity scores for artists, albums, and tracks using Last.fm data."""

import logging
import time

import requests

from crate.db import get_db_ctx, get_setting

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
    with get_db_ctx() as cur:
        cur.execute("SELECT id, artist, name, tag_album FROM library_albums WHERE lastfm_listeners IS NULL")
        albums = [dict(r) for r in cur.fetchall()]

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
                with get_db_ctx() as cur:
                    cur.execute(
                        "UPDATE library_albums SET lastfm_listeners = %s, lastfm_playcount = %s WHERE id = %s",
                        (listeners, playcount, album["id"]),
                    )
                albums_fetched += 1

        time.sleep(0.25)  # Last.fm rate limit

    # 2. Fetch track popularity (sample: tracks from albums with listeners)
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT t.id, t.artist, t.title, t.album
            FROM library_tracks t
            WHERE t.title IS NOT NULL AND t.title != '' AND t.lastfm_listeners IS NULL
        """)
        tracks = [dict(r) for r in cur.fetchall()]

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
                with get_db_ctx() as cur:
                    cur.execute(
                        "UPDATE library_tracks SET lastfm_listeners = %s, lastfm_playcount = %s WHERE id = %s",
                        (listeners, playcount, track["id"]),
                    )
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
    with get_db_ctx() as cur:
        # Artists: use existing listeners column
        cur.execute("SELECT MAX(listeners) AS m FROM library_artists WHERE listeners IS NOT NULL")
        max_artist = cur.fetchone()["m"] or 1
        # We already have spotify_popularity for artists, but update lastfm_playcount
        # Artists don't need a separate popularity column — they have listeners + spotify_popularity

        # Albums: normalize
        cur.execute("SELECT MAX(lastfm_listeners) AS m FROM library_albums WHERE lastfm_listeners IS NOT NULL")
        max_album = cur.fetchone()["m"] or 1
        cur.execute(
            "UPDATE library_albums SET popularity = LEAST(100, GREATEST(1, (lastfm_listeners::float / %s * 100)::int)) "
            "WHERE lastfm_listeners IS NOT NULL AND lastfm_listeners > 0",
            (max_album,),
        )

        # Tracks: normalize
        cur.execute("SELECT MAX(lastfm_listeners) AS m FROM library_tracks WHERE lastfm_listeners IS NOT NULL")
        max_track = cur.fetchone()["m"] or 1
        cur.execute(
            "UPDATE library_tracks SET popularity = LEAST(100, GREATEST(1, (lastfm_listeners::float / %s * 100)::int)) "
            "WHERE lastfm_listeners IS NOT NULL AND lastfm_listeners > 0",
            (max_track,),
        )
