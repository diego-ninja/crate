"""Bounded, connection-scoped access to Bandcamp's web Discover endpoint.

The endpoint is an undocumented browser contract. Keep its request and
response handling isolated so it can be disabled or replaced without making
the rest of the feed depend on it.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import requests

from crate.bandcamp.client import BandcampClientError, assert_bandcamp_url
from crate.bandcamp.models import BandcampSessionMaterial
from crate.bandcamp.web import BandcampWebClient
from crate.db.cache_store import get_cache, set_cache
from crate.provider_rate_limits import wait_for_provider_slot

DISCOVER_ENDPOINT = "/api/discover/1/discover_web"
DISCOVER_RESULT_TYPES = ["a", "s"]
_DEFAULT_PAGE_SIZE = 60
_DEFAULT_MAX_PAGES = 3
_DEFAULT_TIMEOUT_SECONDS = 20.0
_DEFAULT_CACHE_TTL_SECONDS = 21600
_DEFAULT_REQUEST_INTERVAL_SECONDS = 0.5


class BandcampDiscoverError(RuntimeError):
    """Base error for the isolated Discover provider contract."""


class BandcampDiscoverDisabled(BandcampDiscoverError):
    pass


class BandcampDiscoverAuthError(BandcampDiscoverError):
    pass


class BandcampDiscoverRateLimited(BandcampDiscoverError):
    pass


class BandcampDiscoverContractError(BandcampDiscoverError):
    pass


@dataclass(frozen=True)
class BandcampDiscoverItem:
    item: dict[str, Any]
    page_cursor: str
    rank: int


@dataclass(frozen=True)
class BandcampDiscoverResult:
    items: tuple[BandcampDiscoverItem, ...]
    pages_fetched: int
    skipped_items: int
    last_cursor: str
    cache_metadata: dict[str, str]
    cache_hit: bool = False


def bandcamp_discover_enabled() -> bool:
    raw = os.environ.get("CRATE_BANDCAMP_DISCOVER_ENABLED", "false")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def discover_page_size() -> int:
    return _env_int(
        "CRATE_BANDCAMP_DISCOVER_PAGE_SIZE",
        _DEFAULT_PAGE_SIZE,
        minimum=1,
        maximum=60,
    )


def discover_max_pages() -> int:
    return _env_int(
        "CRATE_BANDCAMP_DISCOVER_MAX_PAGES",
        _DEFAULT_MAX_PAGES,
        minimum=1,
        maximum=10,
    )


def discover_timeout() -> float:
    return _env_float(
        "CRATE_BANDCAMP_DISCOVER_TIMEOUT",
        _DEFAULT_TIMEOUT_SECONDS,
        minimum=1.0,
        maximum=120.0,
    )


def discover_cache_ttl() -> int:
    return _env_int(
        "CRATE_BANDCAMP_DISCOVER_CACHE_TTL_SECONDS",
        _DEFAULT_CACHE_TTL_SECONDS,
        minimum=60,
        maximum=86400,
    )


def discover_request_interval() -> float:
    return _env_float(
        "CRATE_BANDCAMP_DISCOVER_MIN_REQUEST_INTERVAL_SECONDS",
        _DEFAULT_REQUEST_INTERVAL_SECONDS,
        minimum=0.0,
        maximum=60.0,
    )


class BandcampDiscoverClient:
    """Fetch a small, sanitized window of releases for followed bands."""

    def __init__(
        self,
        session_material: BandcampSessionMaterial,
        *,
        page_size: int | None = None,
        max_pages: int | None = None,
        timeout: float | None = None,
        enabled: bool | None = None,
        cache_key: str | None = None,
        cache_ttl_seconds: int | None = None,
    ) -> None:
        _assert_valid_session_material(session_material)
        self.web_client = BandcampWebClient(
            session_material,
            timeout=timeout if timeout is not None else discover_timeout(),
        )
        self.page_size = _bounded_int(
            page_size if page_size is not None else discover_page_size(),
            minimum=1,
            maximum=60,
        )
        self.max_pages = _bounded_int(
            max_pages if max_pages is not None else discover_max_pages(),
            minimum=1,
            maximum=10,
        )
        self.enabled = bandcamp_discover_enabled() if enabled is None else bool(enabled)
        self.cache_key = cache_key.strip() if cache_key else ""
        self.cache_ttl_seconds = _bounded_int(
            cache_ttl_seconds
            if cache_ttl_seconds is not None
            else discover_cache_ttl(),
            minimum=60,
            maximum=86400,
        )

    def fetch_followed(self) -> BandcampDiscoverResult:
        if not self.enabled:
            raise BandcampDiscoverDisabled("Bandcamp Discover is disabled")

        if self.cache_key:
            cached = get_cache(
                self.cache_key,
                max_age_seconds=self.cache_ttl_seconds,
            )
            cached_result = _result_from_cache(cached)
            if cached_result is not None:
                return BandcampDiscoverResult(
                    items=cached_result.items,
                    pages_fetched=cached_result.pages_fetched,
                    skipped_items=cached_result.skipped_items,
                    last_cursor=cached_result.last_cursor,
                    cache_metadata=cached_result.cache_metadata,
                    cache_hit=True,
                )

        items: list[BandcampDiscoverItem] = []
        seen_items: set[tuple[str, str]] = set()
        seen_cursors: set[str] = set()
        cursor = "*"
        pages_fetched = 0
        skipped_items = 0
        last_cursor = ""
        cache_metadata: dict[str, str] = {}

        for _page in range(self.max_pages):
            if cursor in seen_cursors:
                break
            seen_cursors.add(cursor)
            page = self._fetch_page(cursor)
            page_items, next_cursor, skipped = parse_discover_page(page)
            pages_fetched += 1
            skipped_items += skipped
            last_cursor = next_cursor
            page_cache_metadata = _response_cache_metadata(page.pop("__headers", {}))
            if page_cache_metadata:
                cache_metadata = page_cache_metadata

            for item in page_items:
                identity = _discover_item_identity(item)
                if identity in seen_items:
                    continue
                seen_items.add(identity)
                items.append(
                    BandcampDiscoverItem(
                        item=item,
                        page_cursor=cursor,
                        rank=len(items),
                    )
                )

            if not page_items or not next_cursor or next_cursor in seen_cursors:
                break
            cursor = next_cursor

        result = BandcampDiscoverResult(
            items=tuple(items),
            pages_fetched=pages_fetched,
            skipped_items=skipped_items,
            last_cursor=last_cursor,
            cache_metadata=cache_metadata,
        )
        if self.cache_key:
            set_cache(
                self.cache_key,
                _result_to_cache(result),
                ttl=self.cache_ttl_seconds,
            )
        return result

    def _fetch_page(self, cursor: str) -> dict[str, Any]:
        wait_for_provider_slot(
            "bandcamp_discover",
            discover_request_interval(),
        )
        try:
            response = self.web_client.session.post(
                f"{self.web_client.BASE_URL}{DISCOVER_ENDPOINT}",
                json={
                    "followed_bands": True,
                    "cursor": cursor,
                    "size": self.page_size,
                    "slice": "new",
                    "include_result_types": DISCOVER_RESULT_TYPES,
                },
                timeout=self.web_client.timeout,
            )
        except requests.RequestException as exc:
            raise BandcampDiscoverError("Bandcamp Discover request failed") from exc

        if response.status_code in {401, 403}:
            raise BandcampDiscoverAuthError(
                "Bandcamp Discover session is no longer authorized"
            )
        if response.status_code == 429:
            raise BandcampDiscoverRateLimited("Bandcamp Discover rate limit reached")
        if response.status_code >= 400:
            raise BandcampDiscoverError(
                f"Bandcamp Discover request failed with {response.status_code}"
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise BandcampDiscoverContractError(
                "Bandcamp Discover response was not JSON"
            ) from exc
        if not isinstance(payload, dict):
            raise BandcampDiscoverContractError(
                "Bandcamp Discover response must be an object"
            )
        payload["__headers"] = getattr(response, "headers", {}) or {}
        return payload


def parse_discover_page(
    payload: dict[str, Any],
) -> tuple[list[dict[str, Any]], str, int]:
    results = payload.get("results")
    if not isinstance(results, list):
        raise BandcampDiscoverContractError(
            "Bandcamp Discover response has no results list"
        )
    if "cursor" not in payload:
        raise BandcampDiscoverContractError("Bandcamp Discover response has no cursor")
    raw_cursor = payload.get("cursor")
    if raw_cursor not in {None, ""} and not isinstance(raw_cursor, str):
        raise BandcampDiscoverContractError("Bandcamp Discover cursor must be a string")

    normalized: list[dict[str, Any]] = []
    skipped = 0
    for raw_item in results:
        if not isinstance(raw_item, dict):
            skipped += 1
            continue
        item = normalize_discover_item(raw_item)
        if item is None:
            skipped += 1
            continue
        normalized.append(item)
    return normalized, str(raw_cursor or ""), skipped


def normalize_discover_item(payload: dict[str, Any]) -> dict[str, Any] | None:
    result_type = _string(payload.get("result_type") or payload.get("type")).lower()
    if result_type in {"a", "s", "album", "release", "publication"}:
        item_type = "album"
    elif result_type in {"t", "track", "song"}:
        item_type = "track"
    else:
        return None

    item_url = _stable_bandcamp_url(
        payload.get("item_url") or payload.get("tralbum_url") or payload.get("url")
    )
    if not item_url:
        return None

    band_id = _int_or_none(payload.get("band_id"))
    album_id = _int_or_none(payload.get("album_id"))
    track_id = _int_or_none(payload.get("track_id"))
    item_id = _int_or_none(
        payload.get("item_id")
        or payload.get("id")
        or (album_id if item_type == "album" else track_id)
    )
    primary_image = _mapping(payload.get("primary_image"))
    artist_name = _string(
        payload.get("band_name")
        or payload.get("artist_name")
        or payload.get("album_artist")
        or payload.get("artist")
    )
    title = _string(payload.get("title") or payload.get("name"))
    album_title = _string(payload.get("album_title") or payload.get("release_title"))
    track_title = _string(payload.get("track_title"))
    if item_type == "album" and not album_title:
        album_title = title
    if item_type == "track" and not track_title:
        track_title = title

    cover_url = _stable_https_url(
        payload.get("cover_url") or payload.get("image_url") or primary_image.get("url")
    )
    artist_url = _stable_bandcamp_url(
        payload.get("artist_url") or payload.get("band_url")
    )
    if not artist_url:
        artist_url = _artist_url_from_item_url(item_url)

    return {
        "bandcamp_item_id": item_id,
        "bandcamp_item_type": item_type,
        "band_id": band_id,
        "album_id": album_id,
        "track_id": track_id,
        "art_id": _int_or_none(
            payload.get("art_id")
            or payload.get("image_id")
            or primary_image.get("image_id")
        ),
        "artist_name": artist_name,
        "album_title": album_title,
        "track_title": track_title,
        "label_name": _string(payload.get("label_name") or payload.get("label")),
        "item_url": item_url,
        "artist_url": artist_url,
        "album_url": _stable_bandcamp_url(
            payload.get("album_url") or (item_url if item_type == "album" else "")
        ),
        "cover_url": cover_url,
        "release_date": _iso_date(
            payload.get("release_date")
            or payload.get("publish_date")
            or payload.get("date")
        ),
        "tags": _string_list(payload.get("tags")),
        "raw": _sanitized_raw_payload(payload),
    }


def _assert_valid_session_material(session_material: Any) -> None:
    if not isinstance(session_material, BandcampSessionMaterial):
        raise BandcampDiscoverAuthError("Bandcamp session material is required")
    if not session_material.cookies or not (
        session_material.profile.username or session_material.profile.fan_id
    ):
        raise BandcampDiscoverAuthError(
            "Bandcamp session cookies and fan identity are required"
        )


def _discover_item_identity(item: dict[str, Any]) -> tuple[str, str]:
    item_id = _int_or_none(item.get("bandcamp_item_id"))
    if item_id is not None:
        return ("id", str(item_id))
    return ("url", _string(item.get("item_url")).lower())


def _result_to_cache(result: BandcampDiscoverResult) -> dict[str, Any]:
    return {
        "items": [
            {
                "item": entry.item,
                "page_cursor": entry.page_cursor,
                "rank": entry.rank,
            }
            for entry in result.items
        ],
        "pages_fetched": result.pages_fetched,
        "skipped_items": result.skipped_items,
        "last_cursor": result.last_cursor,
        "cache_metadata": result.cache_metadata,
    }


def _result_from_cache(payload: Any) -> BandcampDiscoverResult | None:
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        return None
    try:
        pages_fetched = int(payload.get("pages_fetched") or 0)
        skipped_items = int(payload.get("skipped_items") or 0)
    except (TypeError, ValueError):
        return None
    entries: list[BandcampDiscoverItem] = []
    for raw_entry in payload["items"]:
        if not isinstance(raw_entry, dict) or not isinstance(
            raw_entry.get("item"), dict
        ):
            return None
        try:
            rank = int(raw_entry.get("rank") or len(entries))
        except (TypeError, ValueError):
            return None
        entries.append(
            BandcampDiscoverItem(
                item=raw_entry["item"],
                page_cursor=_string(raw_entry.get("page_cursor")),
                rank=rank,
            )
        )
    metadata = payload.get("cache_metadata")
    return BandcampDiscoverResult(
        items=tuple(entries),
        pages_fetched=pages_fetched,
        skipped_items=skipped_items,
        last_cursor=_string(payload.get("last_cursor")),
        cache_metadata={
            str(key): str(value)
            for key, value in metadata.items()
            if str(value).strip()
        }
        if isinstance(metadata, Mapping)
        else {},
    )


def _response_cache_metadata(headers: Any) -> dict[str, str]:
    if not isinstance(headers, Mapping):
        return {}
    mapping = {
        "ETag": "etag",
        "Last-Modified": "last_modified",
        "Cache-Control": "cache_control",
    }
    return {
        target: str(headers[source]).strip()[:256]
        for source, target in mapping.items()
        if str(headers.get(source) or "").strip()
    }


def _sanitized_raw_payload(payload: dict[str, Any]) -> dict[str, Any]:
    stable_fields = {
        "id",
        "item_id",
        "album_id",
        "track_id",
        "band_id",
        "art_id",
        "image_id",
        "result_type",
        "type",
        "item_url",
        "tralbum_url",
        "url",
        "artist_url",
        "band_url",
        "band_name",
        "artist_name",
        "album_artist",
        "artist",
        "title",
        "name",
        "album_title",
        "release_title",
        "track_title",
        "label_name",
        "label",
        "release_date",
        "publish_date",
        "date",
        "tags",
        "cover_url",
        "image_url",
        "primary_image",
        "price",
        "package",
    }
    return {
        key: value
        for key, raw_value in payload.items()
        if key in stable_fields
        and (value := _sanitize_json_value(raw_value, key=key)) is not None
    }


def _sanitize_json_value(value: Any, *, key: str = "") -> Any:
    if _sensitive_key(key):
        return None
    if isinstance(value, dict):
        result = {}
        for child_key, child_value in value.items():
            sanitized = _sanitize_json_value(child_value, key=str(child_key))
            if sanitized is not None:
                result[str(child_key)] = sanitized
        return result
    if isinstance(value, list):
        return [
            sanitized
            for child in value
            if (sanitized := _sanitize_json_value(child)) is not None
        ]
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return None


def _sensitive_key(key: str) -> bool:
    normalized = key.lower().replace("-", "_")
    return any(
        marker in normalized
        for marker in (
            "stream",
            "playback",
            "encoding",
            "signed",
            "token",
            "download",
        )
    )


def _stable_bandcamp_url(value: Any) -> str:
    url = _string(value)
    if not url:
        return ""
    try:
        assert_bandcamp_url(url)
        parsed = urlsplit(url)
    except (BandcampClientError, ValueError):
        return ""
    if parsed.scheme.lower() != "https" or parsed.username or parsed.password:
        return ""
    return urlunsplit(("https", parsed.netloc.lower(), parsed.path.rstrip("/"), "", ""))


def _stable_https_url(value: Any) -> str:
    url = _string(value)
    if not url:
        return ""
    try:
        parsed = urlsplit(url)
    except ValueError:
        return ""
    if parsed.scheme.lower() != "https" or not parsed.netloc:
        return ""
    return urlunsplit(("https", parsed.netloc.lower(), parsed.path, "", ""))


def _artist_url_from_item_url(item_url: str) -> str:
    parsed = urlsplit(item_url)
    host = parsed.hostname or ""
    if not host or host in {"bandcamp.com", "www.bandcamp.com"}:
        return ""
    return f"https://{host}"


def _iso_date(value: Any) -> str | None:
    raw = _string(value)
    if not raw:
        return None
    candidate = raw[:10]
    try:
        date.fromisoformat(candidate)
    except ValueError:
        return None
    return candidate


def _env_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return _bounded_int(value, minimum=minimum, maximum=maximum)


def _env_float(name: str, default: float, *, minimum: float, maximum: float) -> float:
    try:
        value = float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def _bounded_int(value: int, *, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, int(value)))


def _mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _string(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _int_or_none(value: Any) -> int | None:
    if value in {None, ""}:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [_string(item) for item in value if _string(item)]


__all__ = [
    "BandcampDiscoverAuthError",
    "BandcampDiscoverClient",
    "BandcampDiscoverContractError",
    "BandcampDiscoverDisabled",
    "BandcampDiscoverError",
    "BandcampDiscoverItem",
    "BandcampDiscoverRateLimited",
    "BandcampDiscoverResult",
    "bandcamp_discover_enabled",
    "discover_cache_ttl",
    "discover_max_pages",
    "discover_page_size",
    "discover_request_interval",
    "discover_timeout",
    "normalize_discover_item",
    "parse_discover_page",
]
