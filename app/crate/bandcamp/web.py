from __future__ import annotations

import html
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import requests

from crate.bandcamp.client import BandcampClientError, assert_bandcamp_url
from crate.bandcamp.models import BandcampFanIdentity, BandcampSessionMaterial


class BandcampWebError(RuntimeError):
    pass


@dataclass(frozen=True)
class BandcampWebArchive:
    archive_path: Path
    format: str
    message: str = ""


class BandcampWebClient:
    BASE_URL = "https://bandcamp.com"
    COLLECTION_ENDPOINTS = {
        "collection": "/api/fancollection/1/collection_items",
        "wishlist": "/api/fancollection/1/wishlist_items",
        "following": "/api/fancollection/1/following_bands",
    }

    def __init__(
        self,
        session_material: BandcampSessionMaterial,
        *,
        timeout: float = 20.0,
    ) -> None:
        self.session_material = session_material
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Accept": "application/json, text/plain, */*",
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0 Safari/537.36"
                ),
            }
        )
        for name, value in session_material.cookies.items():
            if str(name).strip() and str(value).strip():
                self.session.cookies.set(str(name), str(value))

    def validate_session(self) -> BandcampFanIdentity:
        response = self.session.get(self.BASE_URL, timeout=self.timeout)
        if response.status_code >= 400:
            raise BandcampWebError("Bandcamp session validation failed")
        identity = extract_fan_identity_from_home_html(response.text)
        if not identity.fan_id:
            raise BandcampWebError("Bandcamp session did not expose a fan id")
        return identity

    def sync_collection_payload(
        self,
        *,
        include: list[str] | tuple[str, ...],
        page_size: int = 100,
        max_pages: int = 50,
    ) -> dict[str, Any]:
        fan_id = self.session_material.profile.fan_id or self.validate_session().fan_id
        if not fan_id:
            raise BandcampWebError("Bandcamp fan id is required for collection sync")

        payload: dict[str, Any] = {"message": "Bandcamp web sync completed"}
        for relation_type in _normalize_include(include):
            payload[relation_type] = self._fetch_relation(
                relation_type=relation_type,
                fan_id=fan_id,
                page_size=page_size,
                max_pages=max_pages,
            )
        return payload

    def download_purchase_archive(
        self,
        *,
        item: dict[str, Any],
        output_dir: Path,
        requested_format: str = "flac",
    ) -> BandcampWebArchive:
        redownload_url = self._find_redownload_url(item)
        if not redownload_url:
            raise BandcampWebError("Bandcamp purchase is not downloadable")

        page = self.session.get(redownload_url, timeout=self.timeout)
        if page.status_code >= 400:
            raise BandcampWebError("Bandcamp redownload page failed")

        download_url = resolve_download_url_from_pagedata(
            page.text,
            item=item,
            requested_format=requested_format,
        )
        download_url = self._resolve_stat_download_url(download_url)
        archive_path = self._download_archive(
            download_url=download_url,
            item=item,
            output_dir=output_dir,
            requested_format=requested_format,
        )
        return BandcampWebArchive(
            archive_path=archive_path,
            format=requested_format,
            message="Bandcamp purchase downloaded",
        )

    def _fetch_relation(
        self,
        *,
        relation_type: str,
        fan_id: int,
        page_size: int,
        max_pages: int,
    ) -> list[dict[str, Any]]:
        endpoint = self.COLLECTION_ENDPOINTS[relation_type]
        token = f"{int(time.time())}:0:a::"
        entries: list[dict[str, Any]] = []
        seen_entries: set[tuple[str, str]] = set()

        for _page in range(max_pages):
            try:
                response = self.session.post(
                    f"{self.BASE_URL}{endpoint}",
                    json={
                        "fan_id": fan_id,
                        "count": page_size,
                        "older_than_token": token,
                    },
                    timeout=self.timeout,
                )
            except requests.RequestException as exc:
                raise BandcampWebError("Bandcamp collection request failed") from exc

            if response.status_code == 404 and relation_type == "following":
                return entries
            if response.status_code >= 400:
                raise BandcampWebError(
                    f"Bandcamp {relation_type} sync failed with {response.status_code}"
                )

            try:
                page = response.json()
            except ValueError as exc:
                raise BandcampWebError(
                    "Bandcamp collection response was not JSON"
                ) from exc

            page_entries, next_token = parse_fancollection_page(
                page,
                relation_type=relation_type,
            )
            for entry in page_entries:
                identity = _normalized_entry_identity(
                    entry,
                    relation_type=relation_type,
                )
                if identity in seen_entries:
                    continue
                seen_entries.add(identity)
                entries.append(entry)
            if (
                not page_entries
                or page.get("more_available") is False
                or not next_token
                or next_token == token
            ):
                break
            token = next_token

        return entries

    def _find_redownload_url(self, item: dict[str, Any]) -> str:
        fan_id = self.session_material.profile.fan_id or self.validate_session().fan_id
        if not fan_id:
            raise BandcampWebError("Bandcamp fan id is required for download lookup")

        token = f"{int(time.time())}:0:a::"
        for _page in range(50):
            response = self.session.post(
                f"{self.BASE_URL}{self.COLLECTION_ENDPOINTS['collection']}",
                json={"fan_id": fan_id, "count": 100, "older_than_token": token},
                timeout=self.timeout,
            )
            if response.status_code >= 400:
                raise BandcampWebError("Bandcamp collection lookup failed")
            page = response.json()
            raw_items = _page_items(page)
            redownload_urls = _mapping(page.get("redownload_urls"))
            for raw_item in raw_items:
                if not _collection_item_matches(item, raw_item):
                    continue
                key = build_redownload_key(raw_item)
                if key:
                    return str(redownload_urls.get(key) or "").strip()
            next_token = _next_page_token(raw_items, page)
            if not raw_items or not next_token or next_token == token:
                break
            token = next_token
        return ""

    def _resolve_stat_download_url(self, download_url: str) -> str:
        stat_url = _stat_download_url(download_url)
        if stat_url == download_url:
            return download_url
        response = self.session.get(stat_url, timeout=self.timeout)
        if response.status_code >= 400:
            return download_url
        return resolve_stat_download_url(response.text, fallback=download_url)

    def _download_archive(
        self,
        *,
        download_url: str,
        item: dict[str, Any],
        output_dir: Path,
        requested_format: str,
    ) -> Path:
        output_dir.mkdir(parents=True, exist_ok=True)
        target = output_dir / _archive_filename(item, requested_format)
        response = self.session.get(download_url, stream=True, timeout=self.timeout)
        if response.status_code >= 400:
            raise BandcampWebError("Bandcamp archive download failed")
        content_type = response.headers.get("content-type", "").lower()
        if content_type.startswith("text/html"):
            raise BandcampWebError("Bandcamp archive download returned an HTML page")

        with target.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 256):
                if chunk:
                    handle.write(chunk)
        if target.stat().st_size <= 0:
            raise BandcampWebError("Bandcamp archive download produced an empty file")
        return target


def extract_fan_identity_from_home_html(html_text: str) -> BandcampFanIdentity:
    blob = extract_data_blob(html_text, "HomepageApp")
    identity = _mapping(_mapping(blob.get("pageContext")).get("identity"))
    return BandcampFanIdentity(
        username=_string(
            identity.get("username")
            or identity.get("fanUsername")
            or identity.get("subdomain")
        ),
        fan_id=_int_or_none(identity.get("fanId") or identity.get("fan_id")),
        display_name=_string(identity.get("name") or identity.get("displayName")),
        image_url=_string(identity.get("imageUrl") or identity.get("image_url")),
    )


def extract_data_blob(html_text: str, element_id: str) -> dict[str, Any]:
    element = _find_html_tag_by_id(html_text, element_id)
    if not element:
        return {}
    raw_blob = _extract_html_attr(element, "data-blob")
    if not raw_blob:
        return {}
    try:
        payload = json.loads(html.unescape(raw_blob))
    except json.JSONDecodeError as exc:
        raise BandcampWebError(f"Bandcamp {element_id} data blob was invalid") from exc
    return payload if isinstance(payload, dict) else {}


def _find_html_tag_by_id(html_text: str, element_id: str) -> str:
    id_value = re.escape(element_id)
    pattern = re.compile(
        rf"<[a-zA-Z][^>]*\bid=(['\"]){id_value}\1[^>]*>",
        re.IGNORECASE | re.DOTALL,
    )
    match = pattern.search(html_text)
    return match.group(0) if match else ""


def _extract_html_attr(tag: str, attr_name: str) -> str:
    attr = re.escape(attr_name)
    pattern = re.compile(
        rf"\b{attr}\s*=\s*(['\"])(.*?)\1",
        re.IGNORECASE | re.DOTALL,
    )
    match = pattern.search(tag)
    return str(match.group(2) or "") if match else ""


def parse_fancollection_page(
    payload: dict[str, Any],
    *,
    relation_type: str,
) -> tuple[list[dict[str, Any]], str]:
    raw_items = _page_items(payload)
    redownload_urls = _mapping(payload.get("redownload_urls"))
    entries = [
        entry
        for item in raw_items
        if (
            entry := normalize_fancollection_item(
                item,
                relation_type=relation_type,
                redownload_urls=redownload_urls,
            )
        )
    ]
    return entries, _next_page_token(raw_items, payload)


def normalize_fancollection_item(
    payload: dict[str, Any],
    *,
    relation_type: str,
    redownload_urls: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    item_url = _bandcamp_url(
        payload.get("item_url")
        or payload.get("tralbum_url")
        or payload.get("band_url")
        or payload.get("url")
    )
    if not item_url and relation_type == "following":
        item_url = _following_bandcamp_url(payload)
    if not item_url:
        return None

    item_type = _string(payload.get("item_type") or payload.get("type"))
    if relation_type == "following":
        item_type = "artist"
    elif item_type not in {"album", "track", "artist", "fan"}:
        item_type = "track" if _string(payload.get("track_title")) else "album"

    key = build_redownload_key(payload)
    downloadable = bool(key and _mapping(redownload_urls).get(key))
    artist_url = _bandcamp_url(payload.get("artist_url") or payload.get("band_url"))
    if relation_type == "following" and not artist_url:
        artist_url = item_url
    album_url = _bandcamp_url(
        payload.get("album_url")
        or (item_url if item_type == "album" or "/album/" in item_url else "")
    )
    raw = _sanitized_raw_payload(payload)
    if key:
        raw["download_url_key"] = key

    return {
        "relation_type": relation_type,
        "owned": relation_type == "collection",
        "downloadable": downloadable if relation_type == "collection" else False,
        "purchase_date": _string(payload.get("purchase_date")),
        "added_at": _string(
            payload.get("added_at")
            or payload.get("also_collected_at")
            or payload.get("date_followed")
        ),
        "item": {
            "bandcamp_item_id": _int_or_none(
                payload.get("bandcamp_item_id") or payload.get("item_id")
            ),
            "bandcamp_item_type": item_type,
            "band_id": _int_or_none(payload.get("band_id")),
            "album_id": _int_or_none(payload.get("album_id")),
            "track_id": _int_or_none(payload.get("track_id")),
            "art_id": _int_or_none(payload.get("art_id")),
            "artist_name": _string(
                payload.get("artist_name")
                or payload.get("band_name")
                or payload.get("artist")
                or payload.get("name")
            ),
            "album_title": _string(
                payload.get("album_title")
                or payload.get("item_title")
                or payload.get("album")
                or payload.get("title")
            ),
            "track_title": _string(payload.get("track_title") or payload.get("track")),
            "label_name": _string(payload.get("label_name") or payload.get("label")),
            "item_url": item_url,
            "artist_url": artist_url,
            "album_url": album_url,
            "cover_url": _string(
                payload.get("cover_url")
                or payload.get("item_art_url")
                or payload.get("art_url")
                or payload.get("image_url")
            ),
            "release_date": _string(payload.get("release_date")),
            "tags": _string_list(payload.get("tags")),
            "raw": raw,
        },
    }


def build_redownload_key(payload: dict[str, Any]) -> str:
    sale_item_type = _string(payload.get("sale_item_type"))
    sale_item_id = _string(payload.get("sale_item_id"))
    return f"{sale_item_type}{sale_item_id}" if sale_item_type and sale_item_id else ""


def resolve_download_url_from_pagedata(
    html_text: str,
    *,
    item: dict[str, Any],
    requested_format: str,
) -> str:
    page_data = extract_data_blob(html_text, "pagedata")
    digital_items = page_data.get("digital_items") or []
    if not isinstance(digital_items, list):
        raise BandcampWebError("Bandcamp redownload page had no digital items")

    target_id = _int_or_none(item.get("bandcamp_item_id"))
    raw_json = _mapping(item.get("raw_json") or item.get("raw"))
    if target_id is None:
        target_id = _int_or_none(raw_json.get("item_id"))

    for digital_item in digital_items:
        if not isinstance(digital_item, dict):
            continue
        digital_item_id = _int_or_none(digital_item.get("item_id"))
        if target_id is not None and digital_item_id not in {None, target_id}:
            continue
        downloads = _mapping(digital_item.get("downloads"))
        candidate = _mapping(downloads.get(requested_format))
        download_url = _string(candidate.get("url"))
        if download_url:
            return download_url

    raise BandcampWebError(f"Bandcamp {requested_format} download URL was unavailable")


def resolve_stat_download_url(script_text: str, *, fallback: str) -> str:
    match = re.search(r'"download_url"\s*:\s*"(?P<url>[^"]+)"', script_text)
    if not match:
        return fallback
    try:
        return json.loads(f'"{match.group("url")}"')
    except json.JSONDecodeError:
        return match.group("url").replace("\\/", "/")


def _normalize_include(include: list[str] | tuple[str, ...]) -> list[str]:
    values = [str(value).strip() for value in include if str(value).strip()]
    normalized = [
        value for value in values if value in BandcampWebClient.COLLECTION_ENDPOINTS
    ]
    return normalized or ["collection"]


def _page_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = (
        payload.get("items"),
        payload.get("collection_items"),
        payload.get("wishlist_items"),
        payload.get("bands"),
        payload.get("followed_bands"),
        payload.get("followeers"),
    )
    for value in candidates:
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _following_bandcamp_url(payload: dict[str, Any]) -> str:
    hints = _mapping(payload.get("url_hints"))
    subdomain = _string(hints.get("subdomain")).lower()
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", subdomain):
        return ""
    return _bandcamp_url(f"https://{subdomain}.bandcamp.com")


def _normalized_entry_identity(
    entry: dict[str, Any],
    *,
    relation_type: str,
) -> tuple[str, str]:
    item = _mapping(entry.get("item"))
    if relation_type == "following":
        band_id = _int_or_none(item.get("band_id"))
        if band_id is not None:
            return ("band_id", str(band_id))
    item_id = _int_or_none(item.get("bandcamp_item_id"))
    if item_id is not None:
        return ("item_id", str(item_id))
    return ("item_url", _canonical_url(item.get("item_url")))


def _next_page_token(raw_items: list[dict[str, Any]], payload: dict[str, Any]) -> str:
    token = _string(payload.get("older_than_token") or payload.get("last_token"))
    for item in reversed(raw_items):
        token = _string(item.get("token")) or token
        if token:
            break
    return token


def _collection_item_matches(target: dict[str, Any], candidate: dict[str, Any]) -> bool:
    raw_json = _mapping(target.get("raw_json") or target.get("raw"))
    target_item_id = _int_or_none(
        target.get("bandcamp_item_id") or raw_json.get("item_id")
    )
    candidate_item_id = _int_or_none(candidate.get("item_id"))
    if target_item_id is not None and candidate_item_id == target_item_id:
        return True

    target_album_id = _int_or_none(target.get("album_id") or raw_json.get("album_id"))
    candidate_album_id = _int_or_none(candidate.get("album_id"))
    if target_album_id is not None and candidate_album_id == target_album_id:
        return True

    target_track_id = _int_or_none(target.get("track_id") or raw_json.get("track_id"))
    candidate_track_id = _int_or_none(candidate.get("track_id"))
    if target_track_id is not None and candidate_track_id == target_track_id:
        return True

    target_key = _string(raw_json.get("download_url_key"))
    if target_key and target_key == build_redownload_key(candidate):
        return True

    return _canonical_url(target.get("item_url")) == _canonical_url(
        candidate.get("item_url")
        or candidate.get("tralbum_url")
        or candidate.get("url")
    )


def _stat_download_url(download_url: str) -> str:
    parts = urlsplit(download_url)
    segments = parts.path.split("/")
    for index, segment in enumerate(segments):
        if segment == "download":
            segments[index] = "statdownload"
            return urlunsplit(parts._replace(path="/".join(segments)))
    return download_url


def _archive_filename(item: dict[str, Any], requested_format: str) -> str:
    artist = _string(item.get("artist_name")) or "Bandcamp"
    title = (
        _string(item.get("album_title"))
        or _string(item.get("track_title"))
        or _string(item.get("bandcamp_item_id"))
        or "download"
    )
    return (
        f"{_safe_filename(artist)} - {_safe_filename(title)} [{requested_format}].zip"
    )


def _safe_filename(value: str) -> str:
    cleaned = re.sub(r"[/\\:*?\"<>|]+", "-", value).strip(" .")
    return cleaned[:120] or "bandcamp"


def _sanitized_raw_payload(payload: dict[str, Any]) -> dict[str, Any]:
    raw = dict(payload)
    raw.pop("redownload_url", None)
    raw.pop("redownload_urls", None)
    raw.pop("downloads", None)
    return raw


def _bandcamp_url(value: Any) -> str:
    url = _string(value)
    if not url:
        return ""
    try:
        assert_bandcamp_url(url)
    except (BandcampClientError, ValueError):
        return ""
    return url


def _canonical_url(value: Any) -> str:
    url = _string(value).rstrip("/")
    return url.lower()


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
