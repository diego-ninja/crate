"""Last.fm events scraper — adapted from lastfm-extractor.

Scrapes public Last.fm event listings by location. No API key needed.
Uses BeautifulSoup to parse HTML. Rate-limited at 0.5s between requests.

Results are returned as dicts matching the `shows` table schema for
direct insertion via `consolidate_show()`.
"""

from __future__ import annotations

import logging
import random
import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from bs4.element import Tag

log = logging.getLogger(__name__)

_BASE_URL = "https://www.last.fm"
_EVENTS_PATH = "/events"
_REQUEST_DELAY = 2.5  # conservative to avoid rate limits
_RETRIES = 3
_LAST_REQUEST_AT = 0.0
_SESSION: requests.Session | None = None

EVENT_ID_RE = re.compile(r"/event/(\d+)")

_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:126.0) Gecko/20100101 Firefox/126.0",
]


def _get_session() -> requests.Session:
    """Reuse a session with persistent cookies, realistic headers, and optional VPN proxy."""
    global _SESSION
    if _SESSION is None:
        _SESSION = requests.Session()
        _SESSION.headers.update({
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "User-Agent": random.choice(_USER_AGENTS),
            "DNT": "1",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Cache-Control": "max-age=0",
        })
        # Route through VPN proxy if configured and reachable
        import os
        proxy_url = os.environ.get("SCRAPE_PROXY_URL")
        if proxy_url:
            try:
                requests.get(proxy_url, timeout=3)
                _SESSION.proxies = {"http": proxy_url, "https": proxy_url}
                log.info("Last.fm scraper using proxy: %s", proxy_url)
            except Exception:
                log.info("Proxy %s not reachable, scraping directly", proxy_url)
        # Warm the session with a cookie-setting request
        try:
            _SESSION.get(f"{_BASE_URL}/", timeout=15)
        except Exception:
            log.debug("Session warmup failed", exc_info=True)
    return _SESSION


# ── Data models ───────────────────────────────────────────────────

@dataclass
class EventVenue:
    name: str | None = None
    street_address: str | None = None
    city: str | None = None
    country: str | None = None


@dataclass
class EventDetail:
    title: str | None = None
    poster_image_url: str | None = None
    start_date: str | None = None
    start_time_text: str | None = None
    datetime_local: str | None = None
    venue: EventVenue = field(default_factory=EventVenue)
    event_link_url: str | None = None
    tickets_url: str | None = None
    lineup: list[str] = field(default_factory=list)
    attendance: dict[str, int] = field(default_factory=dict)


@dataclass
class EventRecord:
    event_id: str
    title: str
    lastfm_url: str
    list_date: str | None = None
    list_image_url: str | None = None
    artists: list[str] = field(default_factory=list)
    venue_name: str | None = None
    city: str | None = None
    country: str | None = None
    attendees_count: int | None = None
    detail: EventDetail | None = None


# ── HTTP helpers ──────────────────────────────────────────────────

def _throttle():
    global _LAST_REQUEST_AT
    elapsed = time.monotonic() - _LAST_REQUEST_AT
    # Add jitter: base delay ± 30%
    delay = _REQUEST_DELAY + random.uniform(-0.4, 0.6)
    if elapsed < delay:
        time.sleep(delay - elapsed)
    _LAST_REQUEST_AT = time.monotonic()


def _get_text(url: str, params: dict | None = None) -> str:
    session = _get_session()
    last_error: Exception | None = None
    for attempt in range(1, _RETRIES + 1):
        try:
            _throttle()
            # Set referer to look like natural navigation
            referer = f"{_BASE_URL}/events" if "/event/" in url else f"{_BASE_URL}/"
            resp = session.get(
                url,
                params=params,
                headers={"Referer": referer},
                timeout=15,
            )
            if resp.status_code == 406 or resp.status_code == 429:
                # Rate limited — back off significantly
                wait = 5.0 * attempt + random.uniform(1, 3)
                log.info("Last.fm rate limited (%d), waiting %.1fs", resp.status_code, wait)
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.text
        except requests.RequestException as exc:
            last_error = exc
            if attempt < _RETRIES:
                time.sleep(2.0 * attempt)
    raise last_error or RuntimeError("Request failed")


# ── Listing parser ────────────────────────────────────────────────

def _clean_text(node: Tag | None) -> str | None:
    if not isinstance(node, Tag):
        return None
    text = " ".join(part.strip() for part in node.stripped_strings)
    return text or None


def _attribute(node: Tag | None, name: str) -> str | None:
    if not isinstance(node, Tag):
        return None
    value = node.get(name)
    return str(value).strip() if value else None


def _extract_event_id(url: str) -> str | None:
    match = EVENT_ID_RE.search(url)
    return match.group(1) if match else None


def _extract_first_int(text: str | None) -> int | None:
    if not text:
        return None
    match = re.search(r"(\d+)", text)
    return int(match.group(1)) if match else None


def _parse_date_text(text: str | None) -> str | None:
    if not text:
        return None
    try:
        return datetime.strptime(text, "%A %d %B %Y").date().isoformat()
    except ValueError:
        return None


def _parse_listing_page(html_text: str) -> tuple[list[EventRecord], bool]:
    """Parse a Last.fm events listing page. Returns (events, has_next_page)."""
    soup = BeautifulSoup(html_text, "html.parser")
    events: list[EventRecord] = []

    for heading in soup.select("h2.group-heading"):
        list_date_text = _clean_text(heading)
        list_date = _parse_date_text(list_date_text)
        table = heading.find_next_sibling("table")
        if not isinstance(table, Tag):
            continue

        for row in table.select("tr.events-list-item"):
            title_link = row.select_one(".events-list-item-event--title a")
            if not isinstance(title_link, Tag):
                continue
            href = title_link.get("href")
            if not href:
                continue

            title = _clean_text(title_link) or ""
            event_id = _extract_event_id(str(href))
            if not event_id:
                continue

            lineup_text = _clean_text(row.select_one(".events-list-item-event--lineup"))
            artists = [a.strip() for a in (lineup_text or "").split(",") if a.strip()]
            attendees_text = _clean_text(row.select_one(".events-list-item-attendees a"))

            events.append(EventRecord(
                event_id=event_id,
                title=title,
                lastfm_url=urljoin(_BASE_URL, str(href)),
                list_date=list_date,
                list_image_url=_attribute(row.select_one(".events-list-item-art img"), "src"),
                artists=artists,
                venue_name=_clean_text(row.select_one(".events-list-item-venue--title")),
                city=_clean_text(row.select_one(".events-list-item-venue--city")),
                country=_clean_text(row.select_one(".events-list-item-venue--country")),
                attendees_count=_extract_first_int(attendees_text),
            ))

    has_next = soup.select_one(".pagination-next a") is not None
    return events, has_next


# ── Detail parser ─────────────────────────────────────────────────

def _find_section_by_heading(soup: BeautifulSoup, heading_text: str) -> Tag | None:
    for heading in soup.select(".event-detail h3"):
        if _clean_text(heading) == heading_text:
            parent = heading.parent
            if isinstance(parent, Tag):
                return parent
    return None


def _combine_local_datetime(date_text: str | None, time_text: str | None) -> str | None:
    if not date_text:
        return None
    if not time_text:
        return date_text
    normalized = time_text.strip().upper().replace(" ", "")
    for fmt in ("%I:%M%p", "%I%p"):
        try:
            parsed_time = datetime.strptime(normalized, fmt).time()
            return f"{date_text}T{parsed_time.strftime('%H:%M:%S')}"
        except ValueError:
            continue
    return date_text


def _parse_attendance(soup: BeautifulSoup) -> dict[str, int]:
    attendance: dict[str, int] = {}
    for item in soup.select("li.header-metadata-item"):
        label = _clean_text(item.select_one(".header-metadata-title"))
        value_text = _clean_text(item.select_one(".header-metadata-display a, .header-metadata-display p"))
        value = _extract_first_int(value_text)
        if label and value is not None:
            attendance[label.lower()] = value
    return attendance


def _parse_event_detail(html_text: str) -> EventDetail:
    """Parse a Last.fm event detail page."""
    soup = BeautifulSoup(html_text, "html.parser")
    detail = EventDetail()

    detail.title = _clean_text(soup.select_one("h1.header-title"))
    detail.poster_image_url = _attribute(soup.select_one(".event-poster-preview"), "src")

    date_node = soup.select_one(".qa-event-date")
    strongs = date_node.select("strong") if isinstance(date_node, Tag) else []
    if strongs:
        detail.start_date = _parse_date_text(_clean_text(strongs[0]))
    else:
        node = soup.select_one("[itemprop='startDate']")
        content = _attribute(node, "content")
        if content:
            detail.start_date = content.split("T", 1)[0]
    if len(strongs) > 1:
        detail.start_time_text = _clean_text(strongs[1])
    detail.datetime_local = _combine_local_datetime(detail.start_date, detail.start_time_text)

    location_section = _find_section_by_heading(soup, "Location")
    if location_section is not None:
        detail.venue = EventVenue(
            name=_clean_text(location_section.select_one("[itemprop='name']")),
            street_address=_clean_text(location_section.select_one("[itemprop='streetAddress']")),
            city=_clean_text(location_section.select_one("[itemprop='addressLocality']")),
            country=_clean_text(location_section.select_one("[itemprop='addressCountry']")),
        )

    detail.event_link_url = _attribute(soup.select_one(".qa-event-link a"), "href")
    detail.tickets_url = _attribute(soup.select_one("a.js-stubhub-link"), "href") or None
    detail.attendance = _parse_attendance(soup)

    for item in soup.select("#line-up .grid-items-item"):
        link = item.select_one(".grid-items-item-main-text a")
        if isinstance(link, Tag):
            name = _clean_text(link)
            if name:
                detail.lineup.append(name)

    return detail


# ── Main scraper ──────────────────────────────────────────────────

def scrape_lastfm_events(
    *,
    city: str,
    latitude: float,
    longitude: float,
    radius_km: int = 60,
    max_pages: int = 10,
    from_date: date | None = None,
    to_date: date | None = None,
    fetch_details: bool = False,
    progress_callback=None,
) -> list[dict]:
    """Scrape Last.fm events near a city.

    Returns list of dicts ready for insertion into the `shows` table
    via `consolidate_show()`.
    """
    # Reset session for each scrape run (fresh cookies, new UA)
    global _SESSION
    _SESSION = None

    if from_date is None:
        from_date = date.today()

    events: list[EventRecord] = []
    seen_ids: set[str] = set()

    for page in range(1, max_pages + 1):
        params: dict = {
            "from": from_date.isoformat(),
            "location_0": city,
            "location_1": latitude,
            "location_2": longitude,
            "radius": radius_km * 1000,
        }
        if page > 1:
            params["page"] = page

        try:
            html = _get_text(f"{_BASE_URL}{_EVENTS_PATH}", params=params)
        except Exception:
            log.warning("Failed to fetch Last.fm events page %d for %s", page, city, exc_info=True)
            break

        page_events, has_next = _parse_listing_page(html)
        if not page_events:
            break

        for event in page_events:
            if event.event_id in seen_ids:
                continue
            if event.list_date and event.list_date < from_date.isoformat():
                continue
            if to_date and event.list_date and event.list_date > to_date.isoformat():
                continue
            seen_ids.add(event.event_id)
            events.append(event)

        if to_date:
            page_dates = [e.list_date for e in page_events if e.list_date]
            if page_dates and all(d >= to_date.isoformat() for d in page_dates):
                break

        if not has_next:
            break

    # Fetch detail pages
    if fetch_details:
        for i, event in enumerate(events):
            if progress_callback:
                progress_callback({"phase": "lastfm_details", "done": i, "total": len(events), "event": event.title})
            try:
                detail_html = _get_text(event.lastfm_url)
                event.detail = _parse_event_detail(detail_html)
            except Exception:
                log.debug("Failed to fetch detail for event %s", event.event_id, exc_info=True)

    # Convert to show dicts
    return [_event_to_show_dict(event, city) for event in events]


def _event_to_show_dict(event: EventRecord, scrape_city: str) -> dict:
    """Convert an EventRecord to a dict matching the shows table schema."""
    detail = event.detail
    lineup = detail.lineup if detail and detail.lineup else event.artists

    # Determine the primary artist (headliner)
    artist_name = lineup[0] if lineup else event.title

    # Use detail venue if available, fall back to listing
    venue = event.venue_name
    address = None
    event_city = event.city
    event_country = event.country
    if detail and detail.venue:
        venue = detail.venue.name or venue
        address = detail.venue.street_address
        event_city = detail.venue.city or event_city
        event_country = detail.venue.country or event_country

    # Date and time
    show_date = event.list_date
    local_time = None
    if detail:
        show_date = detail.start_date or show_date
        if detail.datetime_local and "T" in detail.datetime_local:
            local_time = detail.datetime_local.split("T", 1)[1][:5]

    # Image
    image_url = None
    if detail and detail.poster_image_url:
        image_url = detail.poster_image_url
    elif event.list_image_url:
        image_url = event.list_image_url

    # Tickets
    tickets_url = detail.tickets_url if detail else None
    event_url = None
    if detail and detail.event_link_url:
        event_url = detail.event_link_url
    else:
        event_url = event.lastfm_url

    # Attendance
    attendance = 0
    if detail and detail.attendance:
        attendance = sum(detail.attendance.values())
    elif event.attendees_count:
        attendance = event.attendees_count

    return {
        "external_id": f"lastfm:{event.event_id}",
        "artist_name": artist_name,
        "date": show_date,
        "local_time": local_time,
        "venue": venue,
        "address_line1": address,
        "city": event_city,
        "country": event_country,
        "url": event_url,
        "image_url": image_url,
        "lineup": lineup,
        "status": "onsale" if tickets_url else "announced",
        "source": "lastfm",
        "lastfm_event_id": event.event_id,
        "lastfm_url": event.lastfm_url,
        "lastfm_attendance": attendance,
        "tickets_url": tickets_url,
        "scrape_city": scrape_city,
    }
