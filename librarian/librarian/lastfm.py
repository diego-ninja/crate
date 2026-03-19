import os
import re
import logging
import requests

import musicbrainzngs

from librarian.db import get_cache, set_cache, get_mb_cache, set_mb_cache

LASTFM_BASE = "http://ws.audioscrobbler.com/2.0/"
FANART_BASE = "https://webservice.fanart.tv/v3/music/"
LASTFM_PLACEHOLDER_HASH = "2a96cbd8b46e442fc41c2b86b821562f"
log = logging.getLogger(__name__)

musicbrainzngs.set_useragent("musicdock-librarian", "0.1", "https://github.com/musicdock")


def _lastfm_key() -> str | None:
    return os.environ.get("LASTFM_APIKEY")


def _fanart_key() -> str | None:
    return os.environ.get("FANART_API_KEY")


def get_artist_info(artist_name: str) -> dict | None:
    """Get artist info from Last.fm with cache."""
    cache_key = f"lastfm:artist:{artist_name.lower()}"
    cached = get_cache(cache_key, max_age_seconds=86400)  # 24h
    if cached:
        return cached

    api_key = _lastfm_key()
    if not api_key:
        return None

    try:
        resp = requests.get(LASTFM_BASE, params={
            "method": "artist.getinfo",
            "artist": artist_name,
            "api_key": api_key,
            "format": "json",
        }, timeout=10)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        log.debug("Last.fm lookup failed for %s", artist_name)
        return None

    artist = data.get("artist")
    if not artist:
        return None

    bio_content = artist.get("bio", {}).get("summary", "")
    bio_content = re.sub(r'<a href="https://www.last.fm/.*?>Read more on Last\.fm</a>\.?', '', bio_content).strip()
    bio_content = re.sub(r'<[^>]+>', '', bio_content).strip()
    if len(bio_content) > 500:
        bio_content = bio_content[:500].rsplit(' ', 1)[0] + '...'

    images = artist.get("image", [])
    image_url = None
    for img in reversed(images):  # largest last
        url = img.get("#text", "")
        if url and LASTFM_PLACEHOLDER_HASH not in url:
            image_url = url
            break

    tags = [t["name"] for t in artist.get("tags", {}).get("tag", [])]
    similar = [{"name": s["name"]} for s in artist.get("similar", {}).get("artist", [])[:5]]
    stats = artist.get("stats", {})

    result = {
        "bio": bio_content,
        "tags": tags,
        "similar": similar,
        "listeners": int(stats.get("listeners", 0)),
        "playcount": int(stats.get("playcount", 0)),
        "image_url": image_url,
        "url": artist.get("url", ""),
    }

    set_cache(cache_key, result)
    return result


def download_artist_image(image_url: str) -> bytes | None:
    """Download image from URL."""
    if not image_url or LASTFM_PLACEHOLDER_HASH in image_url:
        return None
    try:
        resp = requests.get(image_url, timeout=15)
        resp.raise_for_status()
        if resp.headers.get("content-type", "").startswith("image/"):
            return resp.content
    except Exception:
        pass
    return None


def _get_artist_mbid(artist_name: str) -> str | None:
    """Get MusicBrainz artist MBID by name, with cache."""
    cache_key = f"mb:artist_mbid:{artist_name.lower()}"
    cached = get_mb_cache(cache_key)
    if cached:
        return cached.get("mbid")

    try:
        result = musicbrainzngs.search_artists(artist=artist_name, limit=1)
        artists = result.get("artist-list", [])
        if artists:
            mbid = artists[0]["id"]
            set_mb_cache(cache_key, {"mbid": mbid})
            return mbid
    except Exception:
        log.debug("MB artist search failed for %s", artist_name)

    set_mb_cache(cache_key, {"mbid": None})
    return None


def get_fanart_artist_image(artist_name: str) -> str | None:
    """Get artist thumb URL from fanart.tv via MusicBrainz MBID. Returns URL or None."""
    api_key = _fanart_key()
    if not api_key:
        return None

    cache_key = f"fanart:artist:{artist_name.lower()}"
    cached = get_cache(cache_key, max_age_seconds=86400 * 7)  # 7 days
    if cached:
        return cached.get("url")

    mbid = _get_artist_mbid(artist_name)
    if not mbid:
        set_cache(cache_key, {"url": None})
        return None

    try:
        resp = requests.get(f"{FANART_BASE}{mbid}", params={"api_key": api_key}, timeout=10)
        if resp.status_code == 404:
            set_cache(cache_key, {"url": None})
            return None
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        log.debug("Fanart.tv lookup failed for %s (mbid=%s)", artist_name, mbid)
        return None

    # Prefer artistthumb, fallback to artistbackground or hdmusiclogo
    for key in ("artistthumb", "artistbackground"):
        images = data.get(key, [])
        if images:
            url = images[0].get("url")
            if url:
                set_cache(cache_key, {"url": url})
                return url

    set_cache(cache_key, {"url": None})
    return None


def get_fanart_background(artist_name: str) -> str | None:
    """Get artist background (1920x1080 panoramic) URL from fanart.tv."""
    api_key = _fanart_key()
    if not api_key:
        return None

    cache_key = f"fanart:bg:{artist_name.lower()}"
    cached = get_cache(cache_key, max_age_seconds=86400 * 7)
    if cached:
        return cached.get("url")

    mbid = _get_artist_mbid(artist_name)
    if not mbid:
        set_cache(cache_key, {"url": None})
        return None

    try:
        resp = requests.get(f"{FANART_BASE}{mbid}", params={"api_key": api_key}, timeout=10)
        if resp.status_code == 404:
            set_cache(cache_key, {"url": None})
            return None
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return None

    backgrounds = data.get("artistbackground", [])
    if backgrounds:
        url = backgrounds[0].get("url")
        set_cache(cache_key, {"url": url})
        return url

    set_cache(cache_key, {"url": None})
    return None


def get_best_artist_image(artist_name: str) -> bytes | None:
    """Try all sources to get an artist image: fanart.tv > Last.fm (non-placeholder).
    Returns image bytes or None."""
    # Try fanart.tv first (best quality)
    fanart_url = get_fanart_artist_image(artist_name)
    if fanart_url:
        data = download_artist_image(fanart_url)
        if data:
            return data

    # Try Last.fm (only if non-placeholder)
    info = get_artist_info(artist_name)
    if info and info.get("image_url"):
        data = download_artist_image(info["image_url"])
        if data:
            return data

    return None
