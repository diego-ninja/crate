"""Discogs API client for artist enrichment and collection sync."""

import os
import logging
import requests
from typing import Optional

from musicdock.db import get_setting

log = logging.getLogger(__name__)

DISCOGS_API = "https://api.discogs.com"
USER_AGENT = "Crate/1.0 +https://github.com/crate"


def _headers() -> dict:
    key = get_setting("discogs_consumer_key", os.environ.get("DISCOGS_CONSUMER_KEY", ""))
    secret = get_setting("discogs_consumer_secret", os.environ.get("DISCOGS_CONSUMER_SECRET", ""))
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if key and secret:
        headers["Authorization"] = f"Discogs key={key}, secret={secret}"
    return headers


def is_configured() -> bool:
    key = get_setting("discogs_consumer_key", os.environ.get("DISCOGS_CONSUMER_KEY", ""))
    return bool(key)


def search_artist(name: str) -> Optional[dict]:
    """Search for an artist on Discogs. Returns best match or None."""
    try:
        resp = requests.get(
            f"{DISCOGS_API}/database/search",
            params={"q": name, "type": "artist", "per_page": 5},
            headers=_headers(),
            timeout=10,
        )
        if resp.status_code != 200:
            return None
        results = resp.json().get("results", [])
        if not results:
            return None
        # Return best match (first result, Discogs sorts by relevance)
        return results[0]
    except Exception:
        log.debug("Discogs search failed for %s", name, exc_info=True)
        return None


def get_artist(artist_id: int) -> Optional[dict]:
    """Get full artist details from Discogs."""
    try:
        resp = requests.get(
            f"{DISCOGS_API}/artists/{artist_id}",
            headers=_headers(),
            timeout=10,
        )
        if resp.status_code != 200:
            return None
        return resp.json()
    except Exception:
        log.debug("Discogs get_artist failed for %d", artist_id, exc_info=True)
        return None


def get_artist_releases(artist_id: int, page: int = 1, per_page: int = 100) -> list[dict]:
    """Get artist releases (discography) from Discogs."""
    try:
        resp = requests.get(
            f"{DISCOGS_API}/artists/{artist_id}/releases",
            params={"page": page, "per_page": per_page, "sort": "year", "sort_order": "desc"},
            headers=_headers(),
            timeout=10,
        )
        if resp.status_code != 200:
            return []
        return resp.json().get("releases", [])
    except Exception:
        log.debug("Discogs releases failed for %d", artist_id, exc_info=True)
        return []


def enrich_artist(name: str) -> dict:
    """Enrich artist with Discogs data. Returns dict of enrichment fields."""
    if not is_configured():
        return {}

    result = {}
    match = search_artist(name)
    if not match:
        return {}

    artist_id = match.get("id")
    if not artist_id:
        return {}

    result["discogs_id"] = artist_id
    result["discogs_url"] = match.get("resource_url", "").replace("api.discogs.com", "discogs.com")

    # Get full artist details
    details = get_artist(artist_id)
    if details:
        result["discogs_profile"] = details.get("profile", "")[:2000]
        result["discogs_realname"] = details.get("realname", "")

        # Members/groups
        members = details.get("members", [])
        if members:
            result["discogs_members"] = [m.get("name") for m in members]

        groups = details.get("groups", [])
        if groups:
            result["discogs_groups"] = [g.get("name") for g in groups]

        # Images
        images = details.get("images", [])
        if images:
            result["discogs_image"] = images[0].get("uri", "")

        # URLs
        urls = details.get("urls", [])
        if urls:
            result["discogs_urls"] = urls

    # Get releases for discography comparison
    releases = get_artist_releases(artist_id)
    if releases:
        albums = []
        for r in releases:
            if r.get("type") == "master" or r.get("role", "").lower() == "main":
                albums.append({
                    "title": r.get("title", ""),
                    "year": r.get("year"),
                    "type": r.get("type", ""),
                    "format": r.get("format", ""),
                    "discogs_id": r.get("id"),
                })
        result["discogs_releases"] = albums[:200]

    return result


def get_release(release_id: int) -> Optional[dict]:
    """Get full release details (tracklist, formats, labels)."""
    try:
        resp = requests.get(
            f"{DISCOGS_API}/releases/{release_id}",
            headers=_headers(),
            timeout=10,
        )
        if resp.status_code != 200:
            return None
        return resp.json()
    except Exception:
        log.debug("Discogs get_release failed for %d", release_id, exc_info=True)
        return None


def get_user_collection(username: str, page: int = 1, per_page: int = 100) -> dict:
    """Get a Discogs user's collection (requires OAuth for private collections)."""
    try:
        resp = requests.get(
            f"{DISCOGS_API}/users/{username}/collection/folders/0/releases",
            params={"page": page, "per_page": per_page, "sort": "added", "sort_order": "desc"},
            headers=_headers(),
            timeout=15,
        )
        if resp.status_code != 200:
            return {"releases": [], "pagination": {}}
        data = resp.json()
        return {
            "releases": data.get("releases", []),
            "pagination": data.get("pagination", {}),
        }
    except Exception:
        log.debug("Discogs collection failed for %s", username, exc_info=True)
        return {"releases": [], "pagination": {}}
