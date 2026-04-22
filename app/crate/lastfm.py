import os
import re
import logging
import requests

import musicbrainzngs

from crate.db import get_cache, set_cache, get_mb_cache, set_mb_cache

LASTFM_BASE = "http://ws.audioscrobbler.com/2.0/"
FANART_BASE = "https://webservice.fanart.tv/v3/music/"
LASTFM_PLACEHOLDER_HASH = "2a96cbd8b46e442fc41c2b86b821562f"
log = logging.getLogger(__name__)



def _lastfm_key() -> str | None:
    return os.environ.get("LASTFM_APIKEY")


def _fanart_key() -> str | None:
    return os.environ.get("FANART_API_KEY")


def get_artist_info(artist_name: str) -> dict | None:
    """Get artist info from Last.fm with cache."""
    cache_key = f"lastfm:artist:v2:{artist_name.lower()}"
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

    bio = artist.get("bio", {}) or {}
    bio_content = bio.get("content") or bio.get("summary", "")
    bio_content = re.sub(r'<a href="https://www.last.fm/.*?>Read more on Last\.fm</a>\.?', '', bio_content).strip()
    bio_content = re.sub(r'Read more on Last\.fm\.?$', '', bio_content).strip()
    bio_content = re.sub(r'<[^>]+>', '', bio_content).strip()

    images = artist.get("image", [])
    image_url = None
    for img in reversed(images):  # largest last
        url = img.get("#text", "")
        if url and LASTFM_PLACEHOLDER_HASH not in url:
            image_url = url
            break

    tags = [t["name"] for t in artist.get("tags", {}).get("tag", [])]
    # Get similar artists from dedicated endpoint (more results than artist.getinfo)
    similar = _get_similar_artists(artist_name, limit=30)
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


def _get_similar_artists(artist_name: str, limit: int = 30) -> list[dict]:
    """Get similar artists from Last.fm artist.getsimilar endpoint."""
    key = _lastfm_key()
    if not key:
        return []
    try:
        resp = requests.get(LASTFM_BASE, params={
            "method": "artist.getsimilar",
            "artist": artist_name,
            "api_key": key,
            "format": "json",
            "limit": limit,
        }, timeout=10)
        if resp.status_code != 200:
            return []
        data = resp.json()
        artists = data.get("similarartists", {}).get("artist", [])
        return [{"name": a["name"], "match": float(a.get("match", 0))} for a in artists[:limit]]
    except Exception:
        log.debug("Last.fm getsimilar failed for %s", artist_name)
        return []


def get_top_tracks(artist_name: str, limit: int = 20) -> list[dict] | None:
    """Get top tracks from Last.fm."""
    cache_key = f"lastfm:toptracks:{artist_name.lower()}:{limit}"
    cached = get_cache(cache_key, max_age_seconds=86400)
    if cached:
        return cached.get("tracks")

    api_key = _lastfm_key()
    if not api_key:
        return None

    try:
        resp = requests.get(LASTFM_BASE, params={
            "method": "artist.gettoptracks",
            "artist": artist_name,
            "api_key": api_key,
            "format": "json",
            "limit": limit,
        }, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        raw_tracks = data.get("toptracks", {}).get("track", [])
        tracks = []
        for t in raw_tracks:
            tracks.append({
                "title": t.get("name", ""),
                "playcount": int(t.get("playcount", 0)),
                "listeners": int(t.get("listeners", 0)),
                "url": t.get("url", ""),
            })

        set_cache(cache_key, {"tracks": tracks})
        return tracks
    except Exception:
        log.debug("Last.fm top tracks failed for %s", artist_name)
        return None


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
        result = musicbrainzngs.search_artists(artist=artist_name, limit=10)
        artists = result.get("artist-list", [])
        name_lower = artist_name.lower()
        for a in artists:
            # Only accept exact name match to avoid The Armed → The Beatles
            if a.get("name", "").lower() == name_lower:
                mbid = a["id"]
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
        set_cache(cache_key, {"url": None}, ttl=604800)
        return None

    try:
        resp = requests.get(f"{FANART_BASE}{mbid}", params={"api_key": api_key}, timeout=10)
        if resp.status_code == 404:
            set_cache(cache_key, {"url": None}, ttl=604800)
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
                set_cache(cache_key, {"url": url}, ttl=604800)
                return url

    set_cache(cache_key, {"url": None}, ttl=604800)
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
        set_cache(cache_key, {"url": None}, ttl=604800)
        return None

    try:
        resp = requests.get(f"{FANART_BASE}{mbid}", params={"api_key": api_key}, timeout=10)
        if resp.status_code == 404:
            set_cache(cache_key, {"url": None}, ttl=604800)
            return None
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return None

    backgrounds = data.get("artistbackground", [])
    if backgrounds:
        url = backgrounds[0].get("url")
        set_cache(cache_key, {"url": url}, ttl=604800)
        return url

    set_cache(cache_key, {"url": None}, ttl=604800)
    return None


def get_fanart_all_images(artist_name: str) -> dict | None:
    """Get ALL available image URLs from fanart.tv. Returns dict with backgrounds, thumbs, logos, banners."""
    api_key = _fanart_key()
    if not api_key:
        return None

    cache_key = f"fanart:all:{artist_name.lower()}"
    cached = get_cache(cache_key, max_age_seconds=86400 * 7)
    if cached:
        return cached

    mbid = _get_artist_mbid(artist_name)
    if not mbid:
        return None

    try:
        resp = requests.get(f"{FANART_BASE}{mbid}", params={"api_key": api_key}, timeout=10)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        log.debug("Fanart.tv all-images lookup failed for %s", artist_name)
        return None

    result = {
        "backgrounds": [img["url"] for img in data.get("artistbackground", []) if img.get("url")],
        "thumbs": [img["url"] for img in data.get("artistthumb", []) if img.get("url")],
        "logos": [img["url"] for img in data.get("hdmusiclogo", []) if img.get("url")],
        "banners": [img["url"] for img in data.get("musicbanner", []) if img.get("url")],
    }

    set_cache(cache_key, result, ttl=604800)
    return result


def _deezer_artist_image(artist_name: str) -> str | None:
    """Search Deezer for artist image URL. No auth needed."""
    cache_key = f"deezer:artist_img:{artist_name.lower()}"
    cached = get_cache(cache_key, max_age_seconds=86400 * 7)
    if cached:
        return cached.get("url")

    try:
        resp = requests.get("https://api.deezer.com/search/artist",
                            params={"q": artist_name}, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        for a in data.get("data", []):
            if a.get("name", "").lower() == artist_name.lower():
                url = a.get("picture_xl") or a.get("picture_big")
                if url:
                    set_cache(cache_key, {"url": url}, ttl=604800)
                    return url
    except Exception:
        log.debug("Deezer lookup failed for %s", artist_name)

    set_cache(cache_key, {"url": None}, ttl=604800)
    return None


def get_best_artist_image(artist_name: str) -> bytes | None:
    """Try all sources to get an artist image: fanart.tv > Deezer > Spotify > Last.fm.
    Returns image bytes or None."""
    # Try fanart.tv first (best quality)
    fanart_url = get_fanart_artist_image(artist_name)
    if fanart_url:
        data = download_artist_image(fanart_url)
        if data:
            return data

    # Try Deezer (no auth, good coverage)
    deezer_url = _deezer_artist_image(artist_name)
    if deezer_url:
        data = download_artist_image(deezer_url)
        if data:
            return data

    # Try Spotify
    try:
        from crate.spotify import search_artist as spotify_search
        sp = spotify_search(artist_name)
        if sp and sp.get("images"):
            img_url = sp["images"][0].get("url") if sp["images"] else None
            if img_url:
                data = download_artist_image(img_url)
                if data:
                    return data
    except Exception:
        pass

    # Try Last.fm (only if non-placeholder)
    info = get_artist_info(artist_name)
    if info and info.get("image_url"):
        data = download_artist_image(info["image_url"])
        if data:
            return data

    return None


def get_lastfm_best_background(artist_name: str) -> bytes | None:
    """Scrape Last.fm artist images page, pick the most landscape-oriented image.
    Returns image bytes or None."""
    cache_key = f"lastfm:bg_url:{artist_name.lower()}"
    cached = get_cache(cache_key, max_age_seconds=604800)  # 7d
    if cached:
        url = cached.get("url")
        if url:
            return download_artist_image(url)
        return None

    try:
        safe_name = requests.utils.quote(artist_name, safe="")
        page_url = f"https://www.last.fm/music/{safe_name}/+images"
        resp = requests.get(page_url, timeout=10, headers={
            "User-Agent": "Mozilla/5.0 (compatible; Grooveyard/1.0)",
        })
        if resp.status_code != 200:
            set_cache(cache_key, {"url": None}, ttl=604800)
            return None

        # Extract image hashes from 300x300 thumbnails
        hashes = re.findall(
            r'lastfm\.freetls\.fastly\.net/i/u/300x300/([a-f0-9]+)\.jpg',
            resp.text,
        )
        hashes = list(dict.fromkeys(hashes))  # dedupe, preserve order

        if not hashes:
            set_cache(cache_key, {"url": None}, ttl=604800)
            return None

        # Score by aspect ratio — prefer landscape (ratio > 1.3)
        best_url = None
        best_score = 0

        for img_hash in hashes[:12]:  # check up to 12 images
            url = f"https://lastfm.freetls.fastly.net/i/u/ar0/{img_hash}.jpg"
            try:
                head = requests.head(url, timeout=5, allow_redirects=True)
                if head.status_code != 200:
                    continue
                # Download to check dimensions
                img_resp = requests.get(url, timeout=10)
                if img_resp.status_code != 200 or len(img_resp.content) < 5000:
                    continue

                from io import BytesIO
                from PIL import Image
                img = Image.open(BytesIO(img_resp.content))
                w, h = img.size
                if w < 400 or h < 300:
                    continue

                ratio = w / h
                # Score: prefer landscape (1.3-2.0 ideal), penalize portrait and square
                if ratio >= 1.3:
                    score = min(ratio, 2.5) * 100 + w  # wider + higher res = better
                elif ratio >= 1.0:
                    score = ratio * 50 + w
                else:
                    score = ratio * 20  # portrait, low priority

                if score > best_score:
                    best_score = score
                    best_url = url

            except Exception:
                continue

        set_cache(cache_key, {"url": best_url}, ttl=604800)
        if best_url:
            return download_artist_image(best_url)

    except Exception:
        log.debug("Last.fm image scrape failed for %s", artist_name)

    return None
