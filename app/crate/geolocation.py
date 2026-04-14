"""Geolocation — IP-based city detection and Nominatim geocoding.

IP detection uses ip-api.com (free, 45 req/min, no key).
Geocoding uses Nominatim/OpenStreetMap (free, 1 req/sec).
Both are cached in Redis to avoid repeated calls.
"""

from __future__ import annotations

import logging
import time

import requests

log = logging.getLogger(__name__)

_NOMINATIM_DELAY = 1.1  # seconds between Nominatim requests
_NOMINATIM_LAST_REQUEST = 0.0


def detect_location_from_ip(ip: str) -> dict | None:
    """Detect city/country/coordinates from an IP address.

    Uses ip-api.com free tier. Returns None on failure.
    Results are cached in Redis for 24h.
    """
    if not ip or ip in ("127.0.0.1", "::1", "localhost"):
        return None

    from crate.db.cache import get_cache, set_cache
    cache_key = f"geo:ip:{ip}"
    cached = get_cache(cache_key, max_age_seconds=86400)
    if cached:
        return cached

    try:
        resp = requests.get(
            f"http://ip-api.com/json/{ip}",
            params={"fields": "status,city,country,countryCode,lat,lon"},
            timeout=5,
        )
        data = resp.json()
        if data.get("status") != "success":
            return None

        result = {
            "city": data.get("city") or "",
            "country": data.get("country") or "",
            "country_code": (data.get("countryCode") or "").upper(),
            "latitude": float(data.get("lat") or 0),
            "longitude": float(data.get("lon") or 0),
        }
        set_cache(cache_key, result, ttl=86400)
        return result
    except Exception:
        log.debug("IP geolocation failed for %s", ip, exc_info=True)
        return None


def geocode_city(query: str) -> dict | None:
    """Geocode a city name to coordinates using Nominatim.

    Returns { display_name, latitude, longitude, country, country_code } or None.
    Results are cached in Redis for 30 days.
    """
    global _NOMINATIM_LAST_REQUEST

    normalized = (query or "").strip()
    if not normalized:
        return None

    from crate.db.cache import get_cache, set_cache
    cache_key = f"geo:city:{normalized.lower()}"
    cached = get_cache(cache_key, max_age_seconds=30 * 86400)
    if cached:
        return cached

    # Rate limit
    now = time.monotonic()
    wait = _NOMINATIM_DELAY - (now - _NOMINATIM_LAST_REQUEST)
    if wait > 0:
        time.sleep(wait)
    _NOMINATIM_LAST_REQUEST = time.monotonic()

    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": normalized, "format": "jsonv2", "limit": 1, "addressdetails": 1},
            headers={"User-Agent": "crate/1.0 (https://github.com/crate)"},
            timeout=10,
        )
        resp.raise_for_status()
        items = resp.json()
        if not items:
            return None

        item = items[0]
        address = item.get("address", {})
        result = {
            "display_name": item.get("display_name", normalized),
            "city": address.get("city") or address.get("town") or address.get("village") or normalized.split(",")[0].strip(),
            "country": address.get("country", ""),
            "country_code": (address.get("country_code") or "").upper(),
            "latitude": float(item["lat"]),
            "longitude": float(item["lon"]),
        }
        set_cache(cache_key, result, ttl=30 * 86400)
        return result
    except Exception:
        log.debug("Geocoding failed for %s", normalized, exc_info=True)
        return None


def search_cities(query: str, limit: int = 5) -> list[dict]:
    """Search for cities matching a query. For autocomplete in the UI."""
    global _NOMINATIM_LAST_REQUEST

    normalized = (query or "").strip()
    if len(normalized) < 2:
        return []

    from crate.db.cache import get_cache, set_cache
    cache_key = f"geo:search:{normalized.lower()}"
    cached = get_cache(cache_key, max_age_seconds=7 * 86400)
    if cached:
        return cached

    now = time.monotonic()
    wait = _NOMINATIM_DELAY - (now - _NOMINATIM_LAST_REQUEST)
    if wait > 0:
        time.sleep(wait)
    _NOMINATIM_LAST_REQUEST = time.monotonic()

    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": normalized,
                "format": "jsonv2",
                "limit": limit,
                "addressdetails": 1,
                "featuretype": "city",
            },
            headers={"User-Agent": "crate/1.0 (https://github.com/crate)"},
            timeout=10,
        )
        resp.raise_for_status()
        results = []
        for item in resp.json():
            address = item.get("address", {})
            city = address.get("city") or address.get("town") or address.get("village") or item.get("name", "")
            country = address.get("country", "")
            if not city:
                continue
            results.append({
                "city": city,
                "country": country,
                "country_code": (address.get("country_code") or "").upper(),
                "display_name": f"{city}, {country}" if country else city,
                "latitude": float(item["lat"]),
                "longitude": float(item["lon"]),
            })
        set_cache(cache_key, results, ttl=7 * 86400)
        return results
    except Exception:
        log.debug("City search failed for %s", normalized, exc_info=True)
        return []


def get_client_ip(request) -> str:
    """Extract the real client IP from a FastAPI request behind a reverse proxy."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip", "")
    if real_ip:
        return real_ip
    return request.client.host if request.client else ""
