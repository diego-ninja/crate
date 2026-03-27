"""Enrich album data using MusicBrainz API to validate duplicates."""

import logging
import time

import musicbrainzngs

from musicdock.audio import read_tags
from musicdock.db import get_mb_cache, set_mb_cache
from musicdock.models import Album

log = logging.getLogger(__name__)

# Simple in-memory cache to avoid re-querying within a single process run
_mb_cache: dict[str, dict] = {}


def enrich_album(album: Album) -> dict:
    """Try to get MusicBrainz release info for an album.

    Returns dict with:
        mbid: str | None
        mb_title: str | None
        mb_artist: str | None
        mb_track_count: int | None
        mb_release_group_id: str | None  (same across editions/remasters)
    """
    # First try: read MBID from tags
    mbid = _get_mbid_from_tags(album)

    if mbid:
        return _lookup_release(mbid)

    # Second try: search by artist + album name
    return _search_release(album.artist, album.name)


def _get_mbid_from_tags(album: Album) -> str | None:
    if album.musicbrainz_id:
        return album.musicbrainz_id

    if album.tracks:
        tags = read_tags(album.tracks[0])
        mbid = tags.get("musicbrainz_albumid")
        if mbid:
            album.musicbrainz_id = mbid
        return mbid
    return None


def _lookup_release(mbid: str) -> dict:
    if mbid in _mb_cache:
        return _mb_cache[mbid]

    # Check persistent SQLite cache
    cache_key = f"enricher:release:{mbid}"
    cached = get_mb_cache(cache_key)
    if cached is not None:
        _mb_cache[mbid] = cached
        return cached

    try:
        time.sleep(1.1)  # MusicBrainz rate limit: 1 req/sec
        result = musicbrainzngs.get_release_by_id(
            mbid, includes=["recordings", "release-groups"]
        )
        release = result.get("release", {})
        media = release.get("medium-list", [])
        track_count = sum(int(m.get("track-count", 0)) for m in media)
        rg = release.get("release-group", {})

        info = {
            "mbid": mbid,
            "mb_title": release.get("title"),
            "mb_artist": release.get("artist-credit-phrase"),
            "mb_track_count": track_count,
            "mb_release_group_id": rg.get("id"),
        }
        _mb_cache[mbid] = info
        set_mb_cache(cache_key, info)
        return info
    except Exception as e:
        log.debug("MusicBrainz lookup failed for %s: %s", mbid, e)
        return _empty_result()


def _search_release(artist: str, album: str) -> dict:
    mem_key = f"search:{artist}:{album}"
    if mem_key in _mb_cache:
        return _mb_cache[mem_key]

    # Check persistent SQLite cache
    db_key = f"enricher:search:{artist}:{album}"
    cached = get_mb_cache(db_key)
    if cached is not None:
        _mb_cache[mem_key] = cached
        return cached

    try:
        time.sleep(1.1)
        results = musicbrainzngs.search_releases(
            artist=artist, release=album, limit=3
        )
        releases = results.get("release-list", [])

        if not releases:
            info = _empty_result()
            _mb_cache[mem_key] = info
            set_mb_cache(db_key, info)
            return info

        # Take best match (first result)
        best = releases[0]
        mbid = best.get("id")

        if mbid:
            # Do a full lookup for complete data
            info = _lookup_release(mbid)
            _mb_cache[mem_key] = info
            set_mb_cache(db_key, info)
            return info

        info = _empty_result()
        _mb_cache[mem_key] = info
        set_mb_cache(db_key, info)
        return info
    except Exception as e:
        log.debug("MusicBrainz search failed for %s - %s: %s", artist, album, e)
        return _empty_result()


def _empty_result() -> dict:
    return {
        "mbid": None,
        "mb_title": None,
        "mb_artist": None,
        "mb_track_count": None,
        "mb_release_group_id": None,
    }


def are_same_release_group(album_a: Album, album_b: Album) -> bool | None:
    """Check if two albums belong to the same MusicBrainz release group.

    Returns True/False if we can determine, None if we can't (no MB data).
    Release groups group together different editions of the same album
    (standard, deluxe, remastered, etc.)
    """
    info_a = enrich_album(album_a)
    info_b = enrich_album(album_b)

    rg_a = info_a.get("mb_release_group_id")
    rg_b = info_b.get("mb_release_group_id")

    if rg_a and rg_b:
        return rg_a == rg_b

    return None


def are_different_releases(album_a: Album, album_b: Album) -> bool | None:
    """Check if two albums are confirmed different releases (different release groups).

    Useful to reject false positive duplicates.
    Returns True if confirmed different, False if same, None if can't determine.
    """
    result = are_same_release_group(album_a, album_b)
    if result is None:
        return None
    return not result
