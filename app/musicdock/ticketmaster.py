"""Ticketmaster Discovery API client for upcoming artist events/shows.

Free tier: 5000 calls/day, 5 req/sec.
Docs: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
"""

import os
import logging
import requests
from datetime import datetime, timezone

from musicdock.db import get_setting, get_cache, set_cache

log = logging.getLogger(__name__)

API_BASE = "https://app.ticketmaster.com/discovery/v2"


def _api_key() -> str:
    return get_setting("ticketmaster_api_key", os.environ.get("TICKETMASTER_API_KEY", ""))


def is_configured() -> bool:
    return bool(_api_key())


def search_events(artist_name: str, country_code: str = "", size: int = 10) -> list[dict]:
    """Search upcoming music events for an artist.

    Args:
        artist_name: Artist/attraction name to search for.
        country_code: ISO 2-letter country code to filter (e.g. 'ES', 'US', 'GB'). Empty = worldwide.
        size: Max results (1-200).

    Returns list of normalized event dicts.
    """
    key = _api_key()
    if not key:
        return []

    cache_key = f"ticketmaster:events:{artist_name.lower()}:{country_code}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    try:
        params = {
            "apikey": key,
            "keyword": artist_name,
            "classificationName": "music",
            "size": min(size, 200),
            "sort": "date,asc",
        }
        if country_code:
            params["countryCode"] = country_code

        resp = requests.get(f"{API_BASE}/events.json", params=params, timeout=10)
        if resp.status_code == 429:
            log.warning("Ticketmaster rate limited")
            return []
        if resp.status_code != 200:
            log.debug("Ticketmaster %d for %s", resp.status_code, artist_name)
            return []

        data = resp.json()
        raw_events = data.get("_embedded", {}).get("events", [])

        events = []
        for e in raw_events:
            # Strict filter: artist must be explicitly listed in attractions
            attractions = e.get("_embedded", {}).get("attractions", [])
            if not attractions:
                continue  # skip events without listed artists (tributes, DJ sets, etc.)
            artist_match = any(
                a.get("name", "").lower() == artist_name.lower()
                for a in attractions
            )
            if not artist_match:
                continue

            venue_data = (e.get("_embedded", {}).get("venues") or [{}])[0]
            dates = e.get("dates", {})
            start = dates.get("start", {})

            # Validate coordinates
            lat = venue_data.get("location", {}).get("latitude")
            lon = venue_data.get("location", {}).get("longitude")
            try:
                lat_f = float(lat) if lat else None
                lon_f = float(lon) if lon else None
                if lat_f is not None and (lat_f < -90 or lat_f > 90):
                    lat = lon = None
                if lon_f is not None and (lon_f < -180 or lon_f > 180):
                    lat = lon = None
            except (ValueError, TypeError):
                lat = lon = None

            event = {
                "id": e.get("id", ""),
                "name": e.get("name", ""),
                "date": start.get("dateTime") or start.get("localDate", ""),
                "local_date": start.get("localDate", ""),
                "local_time": start.get("localTime", ""),
                "venue": venue_data.get("name", ""),
                "city": venue_data.get("city", {}).get("name", ""),
                "region": venue_data.get("state", {}).get("name", ""),
                "country": venue_data.get("country", {}).get("name", ""),
                "country_code": venue_data.get("country", {}).get("countryCode", ""),
                "latitude": lat,
                "longitude": lon,
                "url": e.get("url", ""),
                "image": _best_image(e.get("images", [])),
                "price_range": _price_range(e.get("priceRanges", [])),
                "status": dates.get("status", {}).get("code", ""),
                "lineup": [a.get("name", "") for a in attractions],
            }
            events.append(event)

        # Cache for 7 days (shows don't change often)
        set_cache(cache_key, events, ttl=604800)
        return events

    except Exception:
        log.debug("Ticketmaster failed for %s", artist_name, exc_info=True)
        return []


def get_next_show(artist_name: str, country_code: str = "") -> dict | None:
    """Get the next upcoming show. Returns None if no shows."""
    events = search_events(artist_name, country_code=country_code, size=1)
    return events[0] if events else None


def get_upcoming_shows(artist_name: str, country_code: str = "", limit: int = 10) -> list[dict]:
    """Get upcoming shows, limited to N."""
    return search_events(artist_name, country_code=country_code, size=limit)


def _best_image(images: list[dict]) -> str:
    """Pick the best image from Ticketmaster image array (prefer 16:9 ratio, larger)."""
    if not images:
        return ""
    # Prefer 16_9 ratio images
    for img in images:
        if img.get("ratio") == "16_9" and img.get("width", 0) >= 640:
            return img.get("url", "")
    # Fallback to largest
    images_sorted = sorted(images, key=lambda i: i.get("width", 0), reverse=True)
    return images_sorted[0].get("url", "") if images_sorted else ""


def _price_range(ranges: list[dict]) -> dict | None:
    """Extract price range from event."""
    if not ranges:
        return None
    r = ranges[0]
    return {
        "min": r.get("min"),
        "max": r.get("max"),
        "currency": r.get("currency", ""),
    }
