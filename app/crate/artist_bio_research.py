"""Internet evidence collection and LLM consolidation for artist bios."""

from __future__ import annotations

import html
import ipaddress
import logging
import os
import re
import socket
from collections.abc import Callable, Mapping, Sequence
from urllib.parse import quote, urljoin, urlparse

import requests

from crate.artist_bio import normalize_artist_bio

log = logging.getLogger(__name__)

MAX_SOURCES = 8
MAX_EXCERPT_CHARS = 3000
MIN_SUBSTANTIAL_BIO_CHARS = 600
MIN_ACCEPTED_BIO_RATIO = 0.8
MIN_BIO_CONTENT_COVERAGE = 0.45
MAX_PUBLIC_PAGE_REDIRECTS = 3
_USER_AGENT = "Crate/artist-bio-research (+https://cratemusic.app)"
_BLOCKED_HOSTS = {"localhost", "metadata.google.internal", "host.docker.internal"}
_TAG_RE = re.compile(r"<[^>]+>")
_UNSAFE_HTML_RE = re.compile(
    r"<(script|style|noscript|svg|template)\b[^>]*>.*?</\1>", re.I | re.S
)
_BIO_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9'’\-]{2,}", re.I)
_BIO_STOP_WORDS = {
    "about",
    "after",
    "also",
    "been",
    "from",
    "have",
    "into",
    "more",
    "that",
    "their",
    "them",
    "they",
    "this",
    "were",
    "which",
    "with",
}
_WEB_SEARCH_PROVIDER_LABELS = {"tavily": "Tavily", "brave": "Brave"}


def _safe_public_url(value: str) -> str | None:
    try:
        parsed = urlparse(value.strip())
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    try:
        port = parsed.port
    except ValueError:
        return None
    if parsed.username or parsed.password or port not in {None, 80, 443}:
        return None
    hostname = parsed.hostname.casefold().rstrip(".")
    if hostname in _BLOCKED_HOSTS or hostname.endswith(".local"):
        return None
    try:
        addresses = {ipaddress.ip_address(hostname)}
    except ValueError:
        try:
            addresses = {
                ipaddress.ip_address(item[4][0])
                for item in socket.getaddrinfo(
                    hostname, port or 443, type=socket.SOCK_STREAM
                )
            }
        except OSError:
            return None
    if any(
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
        for address in addresses
    ):
        return None
    return parsed.geturl()


def _response_text(response: requests.Response, limit: int = 250_000) -> str:
    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_content(chunk_size=8192):
        if not chunk:
            continue
        remaining = limit - total
        if remaining <= 0:
            break
        data = chunk[:remaining]
        chunks.append(data)
        total += len(data)
    return b"".join(chunks).decode(response.encoding or "utf-8", errors="replace")


def _clean_excerpt(value: str, *, max_chars: int = MAX_EXCERPT_CHARS) -> str:
    value = _UNSAFE_HTML_RE.sub(" ", value or "")
    value = _TAG_RE.sub(" ", value)
    value = html.unescape(value)
    value = re.sub(r"\s+", " ", value).strip()
    return value[:max_chars]


def _bio_paragraphs(value: str) -> list[str]:
    return [paragraph.strip() for paragraph in value.split("\n\n") if paragraph.strip()]


def _draft_loses_substantial_detail(current_bio: str, draft: str) -> bool:
    if len(current_bio) < MIN_SUBSTANTIAL_BIO_CHARS:
        return False
    if len(draft) < len(current_bio) * MIN_ACCEPTED_BIO_RATIO:
        return True
    current_paragraphs = _bio_paragraphs(current_bio)
    draft_paragraphs = _bio_paragraphs(draft)
    return (
        len(current_paragraphs) >= 4
        and len(draft_paragraphs) < len(current_paragraphs) - 1
    )


def _bio_content_tokens(value: str) -> set[str]:
    return {
        token.casefold()
        for token in _BIO_TOKEN_RE.findall(value)
        if token.casefold() not in _BIO_STOP_WORDS
    }


def _content_coverage(expected: str, candidate: str) -> float:
    expected_tokens = _bio_content_tokens(expected)
    if not expected_tokens:
        return 1.0
    return len(expected_tokens & _bio_content_tokens(candidate)) / len(expected_tokens)


def _draft_omits_existing_content(
    current_bio: str,
    draft: str,
    changes: Sequence[object],
) -> bool:
    """Reject a rewrite that silently drops existing factual paragraphs.

    The LLM is asked to return a semantic diff, but this guard treats the
    existing text as the safer source of truth when a paragraph is neither
    represented in the draft nor explicitly marked as removed or updated. An
    unchanged item must still be present in the draft itself. It is deliberately
    conservative because the result is only a review proposal, not an automatic
    replacement.
    """
    current_paragraphs = _bio_paragraphs(current_bio)
    if len(current_paragraphs) < 3:
        return False

    candidates = _bio_paragraphs(draft)
    for change in changes:
        status = getattr(change, "status", None)
        if status not in {"removed", "updated"}:
            continue
        text = getattr(change, "text", None)
        previous_text = getattr(change, "previous_text", None)
        candidates.extend(
            value
            for value in (text, previous_text)
            if isinstance(value, str) and value.strip()
        )

    omitted = sum(
        max(
            (_content_coverage(paragraph, candidate) for candidate in candidates),
            default=0.0,
        )
        < MIN_BIO_CONTENT_COVERAGE
        for paragraph in current_paragraphs
    )
    return omitted >= max(1, len(current_paragraphs) // 4)


def _unchanged_bio_changes(current_bio: str) -> list[dict[str, object]]:
    return [
        {
            "status": "unchanged",
            "text": paragraph,
            "previous_text": None,
            "source_ids": [],
        }
        for paragraph in _bio_paragraphs(current_bio)
    ]


def _get_json(
    url: str, *, params: Mapping[str, str | int] | None = None
) -> dict | None:
    try:
        response = requests.get(
            url,
            params=params,
            headers={"User-Agent": _USER_AGENT, "Accept": "application/json"},
            timeout=(5, 15),
        )
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, dict) else None
    except (requests.RequestException, ValueError, TypeError):
        log.info("Artist research source failed: %s", url, exc_info=True)
        return None


def _get_public_page(url: str) -> str | None:
    safe_url = _safe_public_url(url)
    if not safe_url:
        return None

    current_url = safe_url
    for _ in range(MAX_PUBLIC_PAGE_REDIRECTS + 1):
        response = None
        try:
            response = requests.get(
                current_url,
                headers={"User-Agent": _USER_AGENT, "Accept": "text/html, text/plain"},
                timeout=(5, 15),
                stream=True,
                allow_redirects=False,
            )
            if response.is_redirect:
                location = response.headers.get("Location")
                next_url = _safe_public_url(urljoin(current_url, location or ""))
                if not next_url:
                    return None
                current_url = next_url
                continue

            response.raise_for_status()
            return _clean_excerpt(_response_text(response))
        except requests.RequestException:
            log.info("Official artist page failed: %s", current_url, exc_info=True)
            return None
        finally:
            if response is not None:
                response.close()

    log.info("Official artist page exceeded redirect limit: %s", safe_url)
    return None


def configured_web_search_providers() -> list[str]:
    """Return configured providers in deterministic primary/fallback order."""
    return [
        provider
        for provider in ("tavily", "brave")
        if os.environ.get(
            "TAVILY_API_KEY" if provider == "tavily" else "BRAVE_SEARCH_API_KEY",
            "",
        ).strip()
    ]


def web_search_provider_label() -> str:
    providers = configured_web_search_providers()
    if not providers:
        return "curated public sources"
    if len(providers) == 1:
        return _WEB_SEARCH_PROVIDER_LABELS[providers[0]]
    primary, fallback = providers[:2]
    return (
        f"{_WEB_SEARCH_PROVIDER_LABELS[primary]} (primary), "
        f"{_WEB_SEARCH_PROVIDER_LABELS[fallback]} (fallback)"
    )


def _source(
    source_id: str, title: str, url: str, excerpt: str, kind: str
) -> dict[str, object]:
    return {
        "id": source_id,
        "title": title[:160],
        "url": url[:500],
        "kind": kind,
        "excerpt": _clean_excerpt(excerpt),
    }


def _collect_musicbrainz(name: str, mbid: str | None) -> list[dict[str, object]]:
    candidates = _get_json(
        "https://musicbrainz.org/ws/2/artist/",
        params={"query": f'artist:"{name}"', "fmt": "json", "limit": 5},
    )
    artists = (candidates or {}).get("artists", [])
    if not isinstance(artists, list):
        artists = []
    selected = (
        next(
            (
                item
                for item in artists
                if isinstance(item, dict) and item.get("id") == mbid
            ),
            None,
        )
        or next(
            (
                item
                for item in artists
                if isinstance(item, dict)
                and str(item.get("name", "")).casefold() == name.casefold()
            ),
            None,
        )
        or (artists[0] if artists and isinstance(artists[0], dict) else None)
    )
    if not selected:
        return []
    selected_mbid = str(selected.get("id") or "")
    detail = (
        _get_json(
            f"https://musicbrainz.org/ws/2/artist/{quote(selected_mbid)}",
            params={"fmt": "json", "inc": "url-rels+artist-rels"},
        )
        if selected_mbid
        else None
    )
    payload = detail or selected
    excerpt_parts = [
        f"Name: {payload.get('name', name)}",
        f"Type: {payload.get('type', '')}",
        f"Country: {payload.get('country', '')}",
        f"Area: {(payload.get('area') or {}).get('name', '') if isinstance(payload.get('area'), dict) else ''}",
        f"Life-span: {payload.get('life-span', '')}",
        f"Disambiguation: {payload.get('disambiguation', '')}",
    ]
    relations = payload.get("artist-relation-list", [])
    if isinstance(relations, list):
        for relation in relations[:60]:
            if not isinstance(relation, dict):
                continue
            relation_type = str(relation.get("type") or "")
            if relation_type not in {"member of band", "is person"}:
                continue
            member = relation.get("artist")
            if not isinstance(member, dict) or not member.get("name"):
                continue
            attributes = relation.get("attribute-list") or []
            if isinstance(attributes, list):
                roles = ", ".join(str(attribute)[:80] for attribute in attributes[:6])
            else:
                roles = str(attributes)[:240]
            begin = str(relation.get("begin") or "")[:32]
            end = str(relation.get("end") or "")[:32]
            excerpt_parts.append(
                "Member: "
                f"{str(member['name'])[:160]} | Roles: {roles} | "
                f"From: {begin} | To: {end or 'present'}"
            )
    return [
        _source(
            "musicbrainz",
            "MusicBrainz artist record",
            f"https://musicbrainz.org/artist/{selected_mbid}",
            "\n".join(excerpt_parts),
            "musicbrainz",
        )
    ]


def _collect_wikipedia(name: str) -> list[dict[str, object]]:
    result = _get_json(
        "https://en.wikipedia.org/w/rest.php/v1/search/page",
        params={"q": name, "limit": 3},
    )
    pages = (result or {}).get("pages", [])
    if not isinstance(pages, list):
        return []
    for page in pages:
        if not isinstance(page, dict) or not page.get("title"):
            continue
        title = str(page["title"])
        summary = _get_json(
            f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(title)}"
        )
        excerpt = (summary or {}).get("extract") or page.get("description") or ""
        if excerpt:
            return [
                _source(
                    "wikipedia",
                    f"Wikipedia — {title}",
                    f"https://en.wikipedia.org/wiki/{quote(title.replace(' ', '_'))}",
                    str(excerpt),
                    "encyclopedia",
                )
            ]
    return []


def _collect_lastfm(name: str) -> list[dict[str, object]]:
    from crate.lastfm import get_artist_info

    payload = get_artist_info(name)
    if not isinstance(payload, dict) or not payload.get("bio"):
        return []
    url = str(payload.get("url") or f"https://www.last.fm/music/{quote(name)}")
    return [
        _source("lastfm", "Last.fm artist profile", url, str(payload["bio"]), "profile")
    ]


def _collect_tavily(name: str) -> list[dict[str, object]]:
    api_key = os.environ.get("TAVILY_API_KEY", "").strip()
    if not api_key:
        return []
    try:
        response = requests.post(
            "https://api.tavily.com/search",
            json={
                "query": f'"{name}" musician artist',
                "search_depth": "basic",
                "max_results": 5,
                "include_answer": False,
                "include_raw_content": False,
            },
            headers={
                "User-Agent": _USER_AGENT,
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            timeout=(5, 15),
        )
        response.raise_for_status()
        payload = response.json()
        results = payload.get("results", []) if isinstance(payload, dict) else []
    except (requests.RequestException, ValueError, TypeError):
        log.info("Tavily artist research failed", exc_info=True)
        return []

    sources = []
    for index, item in enumerate(results if isinstance(results, list) else []):
        if not isinstance(item, dict) or not item.get("url") or not item.get("content"):
            continue
        safe_url = _safe_public_url(str(item["url"]))
        if safe_url:
            sources.append(
                _source(
                    f"tavily-{index + 1}",
                    str(item.get("title") or safe_url),
                    safe_url,
                    str(item["content"]),
                    "web_search",
                )
            )
    return sources


def _collect_brave(name: str) -> list[dict[str, object]]:
    api_key = os.environ.get("BRAVE_SEARCH_API_KEY", "").strip()
    if not api_key:
        return []
    try:
        response = requests.get(
            "https://api.search.brave.com/res/v1/web/search",
            params={"q": f'"{name}" musician artist', "count": 5},
            headers={"X-Subscription-Token": api_key, "Accept": "application/json"},
            timeout=(5, 15),
        )
        response.raise_for_status()
        results = response.json().get("web", {}).get("results", [])
    except (requests.RequestException, ValueError, TypeError):
        return []
    sources = []
    for index, item in enumerate(results if isinstance(results, list) else []):
        if (
            not isinstance(item, dict)
            or not item.get("url")
            or not item.get("description")
        ):
            continue
        safe_url = _safe_public_url(str(item["url"]))
        if safe_url:
            sources.append(
                _source(
                    f"brave-{index + 1}",
                    str(item.get("title") or safe_url),
                    safe_url,
                    str(item["description"]),
                    "web_search",
                )
            )
    return sources


def _collect_web_search(name: str) -> list[dict[str, object]]:
    collectors = {"tavily": _collect_tavily, "brave": _collect_brave}
    for provider in configured_web_search_providers():
        try:
            sources = collectors[provider](name)
        except Exception:
            log.info("Artist research provider failed: %s", provider, exc_info=True)
            continue
        if sources:
            return sources
        log.info("Artist research provider returned no sources: %s", provider)
    return []


def collect_artist_research_sources(
    artist: Mapping[str, object],
    *,
    progress: Callable[[str], None] | None = None,
) -> list[dict[str, object]]:
    name = str(artist.get("name") or "").strip()
    if not name:
        raise ValueError("Artist name is required")
    sources: list[dict[str, object]] = []
    for label, collector in (
        (
            "MusicBrainz",
            lambda: _collect_musicbrainz(name, str(artist.get("mbid") or "") or None),
        ),
        ("Wikipedia", lambda: _collect_wikipedia(name)),
        ("Last.fm", lambda: _collect_lastfm(name)),
        ("Web search", lambda: _collect_web_search(name)),
    ):
        if progress:
            progress(f"Searching {label}")
        try:
            sources.extend(collector())
        except Exception:
            log.info("Artist research collector failed: %s", label, exc_info=True)

    urls = artist.get("urls_json")
    if isinstance(urls, dict):
        for index, (label, url) in enumerate(list(urls.items())[:3]):
            safe_url = _safe_public_url(str(url))
            if not safe_url:
                continue
            if progress:
                progress(f"Reading {label}")
            excerpt = _get_public_page(safe_url)
            if excerpt:
                sources.append(
                    _source(
                        f"official-{index + 1}",
                        str(label),
                        safe_url,
                        excerpt,
                        "official",
                    )
                )

    unique: list[dict[str, object]] = []
    seen_urls: set[str] = set()
    for source in sources:
        url = str(source.get("url") or "")
        if not source.get("excerpt") or url in seen_urls:
            continue
        seen_urls.add(url)
        unique.append(source)
        if len(unique) >= MAX_SOURCES:
            break
    if not unique:
        raise RuntimeError("No usable internet sources were found for this artist")
    return unique


def research_artist_bio(
    artist: Mapping[str, object],
    *,
    language: str = "English",
    progress: Callable[[str], None] | None = None,
) -> dict[str, object]:
    from datetime import datetime, timezone

    from crate.llm import get_config
    from crate.llm.prompts.artist_bio_research import consolidate_artist_bio

    current_bio = normalize_artist_bio(str(artist.get("bio") or ""))
    sources = collect_artist_research_sources(artist, progress=progress)
    if progress:
        progress("Consolidating evidence with AI")
    response = consolidate_artist_bio(
        artist_name=str(artist["name"]),
        current_bio=current_bio,
        artist_context=dict(artist),
        sources=sources,
        language=language,
    )
    draft = "\n\n".join(response.paragraphs)
    preserve_current_bio = bool(current_bio) and response.bio_action == "preserve"
    warnings = list(response.warnings)
    shorter_draft = (
        bool(current_bio)
        and response.bio_action == "update"
        and _draft_loses_substantial_detail(current_bio, draft)
    )
    omitted_content = (
        bool(current_bio)
        and response.bio_action == "update"
        and _draft_omits_existing_content(current_bio, draft, response.bio_changes)
    )
    draft_loses_detail = shorter_draft or omitted_content
    if draft_loses_detail:
        preserve_current_bio = True
        warnings.append(
            (
                "The generated draft was substantially shorter than the existing biography, so the current text was preserved for review."
                if shorter_draft
                else "The generated draft omitted supported detail from the existing biography, so the current text was preserved for review."
            )
        )
    paragraphs = (
        _bio_paragraphs(current_bio) if preserve_current_bio else response.paragraphs
    )
    bio_changes = [change.model_dump() for change in response.bio_changes]
    if not bio_changes and preserve_current_bio:
        bio_changes = _unchanged_bio_changes(current_bio)
    if not bio_changes and not preserve_current_bio:
        bio_changes = [
            {
                "status": "updated",
                "text": draft,
                "previous_text": current_bio or None,
                "source_ids": [],
            }
        ]
    proposal = "\n\n".join(paragraphs)
    return {
        "schema_version": 1,
        "artist": str(artist["name"]),
        "proposal": proposal,
        "bio": {"paragraphs": paragraphs},
        "bio_action": "preserve" if preserve_current_bio else response.bio_action,
        "review_items": [item.model_dump() for item in response.review_items],
        "bio_changes": bio_changes,
        "members": {
            "current": [member.model_dump() for member in response.current_members],
            "former": [member.model_dump() for member in response.former_members],
        },
        "claims": [claim.model_dump() for claim in response.claims],
        "conflicts": response.conflicts,
        "warnings": warnings[:8],
        "sources": sources,
        "model": get_config().get("model"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


__all__ = [
    "collect_artist_research_sources",
    "configured_web_search_providers",
    "research_artist_bio",
    "_safe_public_url",
    "web_search_provider_label",
]
