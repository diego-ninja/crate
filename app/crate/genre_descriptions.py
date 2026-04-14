from __future__ import annotations

import html
import logging
import re
import threading
import time
from typing import Callable

import requests

from crate.genre_taxonomy import get_genre_alias_terms

log = logging.getLogger(__name__)

_MB_ALL_CACHE_KEY = "genre:musicbrainz:all:v1"
_MB_ALL_TTL = 7 * 86400
_WIKIDATA_TTL = 30 * 86400
_MB_RATE_LIMIT_SECONDS = 1.05
_MB_LAST_REQUEST_AT = 0.0
_MB_LOCK = threading.Lock()

_GENERIC_WIKIDATA_DESCRIPTIONS = {
    "genre of music",
    "music genre",
    "musical genre",
    "type of music",
    "style of music",
    "form of music",
    "genre of popular music",
    "genre of electronic music",
    "subgenre",
    "music style",
}


def _mb_headers() -> dict[str, str]:
    return {
        "User-Agent": "crate/1.0 (https://github.com/crate)",
        "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
    }


def _genre_lookup_key(value: str) -> str:
    normalized = (value or "").strip().lower()
    normalized = re.sub(r"\s+", " ", normalized)
    normalized = re.sub(r"-+", "-", normalized)
    normalized = normalized.replace("&", " and ")
    normalized = re.sub(r"[-_/]+", " ", normalized)
    normalized = re.sub(r"[^a-z0-9\s]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _extract_wikidata_entity_id(value: str) -> str | None:
    match = re.search(r"(Q\d+)", value or "", flags=re.IGNORECASE)
    return match.group(1).upper() if match else None


def _is_low_value_description(value: str) -> bool:
    normalized = re.sub(r"\s+", " ", (value or "").strip().lower()).strip(". ")
    return normalized in _GENERIC_WIKIDATA_DESCRIPTIONS


def _throttle_musicbrainz() -> None:
    global _MB_LAST_REQUEST_AT
    with _MB_LOCK:
        now = time.monotonic()
        wait = _MB_RATE_LIMIT_SECONDS - (now - _MB_LAST_REQUEST_AT)
        if wait > 0:
            time.sleep(wait)
        _MB_LAST_REQUEST_AT = time.monotonic()


def _request_json(url: str, *, params: dict | None = None, timeout: int = 15, headers: dict[str, str] | None = None) -> dict | None:
    response = requests.get(url, params=params, timeout=timeout, headers=headers)
    response.raise_for_status()
    return response.json()


def _request_text(url: str, *, params: dict | None = None, timeout: int = 15, headers: dict[str, str] | None = None) -> str:
    response = requests.get(url, params=params, timeout=timeout, headers=headers)
    response.raise_for_status()
    return response.text


def _parse_musicbrainz_genre_catalog(payload: dict) -> list[dict]:
    rows = payload.get("genres") or payload.get("genre-list") or payload.get("genre_list") or []
    parsed: list[dict] = []
    for row in rows:
        name = (row.get("name") or "").strip()
        mbid = (row.get("id") or row.get("gid") or "").strip()
        if not name or not mbid:
            continue
        parsed.append({"mbid": mbid, "name": name})
    return parsed


def fetch_musicbrainz_genre_catalog(*, force: bool = False) -> list[dict]:
    from crate.db import get_cache, set_cache

    cached = None if force else get_cache(_MB_ALL_CACHE_KEY, max_age_seconds=_MB_ALL_TTL)
    if cached:
        return cached

    items: list[dict] = []
    offset = 0
    limit = 100
    total = None
    while total is None or offset < total:
        _throttle_musicbrainz()
        payload = _request_json(
            "https://musicbrainz.org/ws/2/genre/all",
            params={"fmt": "json", "limit": limit, "offset": offset},
            headers=_mb_headers(),
        ) or {}
        batch = _parse_musicbrainz_genre_catalog(payload)
        if not batch:
            break
        items.extend(batch)
        total = int(payload.get("genre-count") or payload.get("count") or len(items))
        offset += len(batch)

    deduped: list[dict] = []
    seen: set[str] = set()
    for row in items:
        key = row["mbid"]
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)

    set_cache(_MB_ALL_CACHE_KEY, deduped, ttl=_MB_ALL_TTL)
    return deduped


def _musicbrainz_genre_index() -> dict[str, dict]:
    index: dict[str, dict] = {}
    try:
        rows = fetch_musicbrainz_genre_catalog()
    except Exception:
        log.warning("Failed to fetch MusicBrainz genre catalog", exc_info=True)
        rows = []
    for row in rows:
        key = _genre_lookup_key(row["name"])
        if key and key not in index:
            index[key] = row
    return index


def _find_musicbrainz_match(node: dict, index: dict[str, dict]) -> dict | None:
    candidates: list[str] = []
    name = (node.get("name") or "").strip()
    slug = (node.get("slug") or "").strip().lower()
    if name:
        candidates.append(name)
    if slug:
        candidates.append(slug.replace("-", " "))
    for term in get_genre_alias_terms(slug):
        if term not in candidates:
            candidates.append(term)

    for candidate in candidates:
        match = index.get(_genre_lookup_key(candidate))
        if match:
            return match
    return None


def fetch_musicbrainz_genre_external_links(mbid: str, *, force: bool = False) -> dict:
    from crate.db import get_mb_cache, set_mb_cache

    cache_key = f"mb:genre:links:{mbid}"
    cached = None if force else get_mb_cache(cache_key)
    if cached:
        return cached

    urls_to_try = [
        f"https://musicbrainz.org/genre/{mbid}",
        f"https://musicbrainz.org/genre/{mbid}/details",
    ]
    wikidata_url = ""
    for url in urls_to_try:
        try:
            _throttle_musicbrainz()
            page_html = _request_text(url, headers=_mb_headers())
        except Exception:
            continue
        match = re.search(r"https?://www\.wikidata\.org/wiki/(Q\d+)", page_html, flags=re.IGNORECASE)
        if match:
            wikidata_url = f"https://www.wikidata.org/wiki/{match.group(1).upper()}"
            break

    result = {
        "musicbrainz_mbid": mbid,
        "wikidata_url": wikidata_url or None,
        "wikidata_entity_id": _extract_wikidata_entity_id(wikidata_url),
    }
    set_mb_cache(cache_key, result)
    return result


def _strip_musicbrainz_html_to_lines(html_text: str) -> list[str]:
    cleaned = re.sub(r"(?is)<script\b[^>]*>.*?</script>", "\n", html_text or "")
    cleaned = re.sub(r"(?is)<style\b[^>]*>.*?</style>", "\n", cleaned)
    cleaned = re.sub(r"(?i)<br\s*/?>", "\n", cleaned)
    cleaned = re.sub(r"(?i)</(p|div|li|ul|ol|h1|h2|h3|h4|section|article|table|tr|td|th)>", "\n", cleaned)
    cleaned = re.sub(r"(?i)<[^>]+>", "", cleaned)
    text = html.unescape(cleaned)
    lines: list[str] = []
    for raw_line in text.splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        if line:
            lines.append(line)
    return lines


def _normalize_musicbrainz_relation_name(value: str) -> str:
    normalized = re.sub(r"\s+\([^)]+\)$", "", (value or "").strip())
    normalized = re.sub(r"\[[^\]]+\]$", "", normalized).strip()
    normalized = re.sub(r"\s+", " ", normalized).strip().lower()
    return normalized


def _parse_musicbrainz_genre_relationships(lines: list[str]) -> dict[str, list[str]]:
    relationships: dict[str, list[str]] = {}
    in_relationships = False
    current_label: str | None = None

    for line in lines:
        normalized = re.sub(r"^\#+\s*", "", line).strip()
        normalized_lower = normalized.lower()
        if normalized_lower == "relationships":
            in_relationships = True
            current_label = None
            continue
        if not in_relationships:
            continue
        if normalized_lower in {"external links", "editing", "collections", "aliases", "associated tags"}:
            break

        label_match = re.match(
            r"^(subgenre of|subgenres|influenced by|influenced genres|fusion of|has fusion genres):\s*(.*)$",
            normalized_lower,
        )
        if label_match:
            current_label = label_match.group(1)
            relationships.setdefault(current_label, [])
            remainder = _normalize_musicbrainz_relation_name(label_match.group(2))
            if remainder:
                relationships[current_label].append(remainder)
            continue

        if current_label:
            candidate = _normalize_musicbrainz_relation_name(normalized)
            if candidate:
                relationships.setdefault(current_label, []).append(candidate)

    deduped: dict[str, list[str]] = {}
    for label, values in relationships.items():
        seen: set[str] = set()
        deduped[label] = []
        for value in values:
            if not value or value in seen:
                continue
            seen.add(value)
            deduped[label].append(value)
    return deduped


def _map_musicbrainz_relationships(current_name: str, relationships: dict[str, list[str]]) -> list[dict]:
    current = _normalize_musicbrainz_relation_name(current_name)
    edges: list[dict] = []
    seen: set[tuple[str, str, str]] = set()

    def add_edge(source_name: str, target_name: str, relation_type: str) -> None:
        source = _normalize_musicbrainz_relation_name(source_name)
        target = _normalize_musicbrainz_relation_name(target_name)
        if not source or not target or source == target:
            return
        key = (source, target, relation_type)
        if key in seen:
            return
        seen.add(key)
        edges.append({"source_name": source, "target_name": target, "relation_type": relation_type})

    for related_name in relationships.get("subgenre of", []):
        add_edge(current, related_name, "parent")
    for related_name in relationships.get("subgenres", []):
        add_edge(related_name, current, "parent")
    for related_name in relationships.get("influenced by", []):
        add_edge(current, related_name, "influenced_by")
    for related_name in relationships.get("influenced genres", []):
        add_edge(related_name, current, "influenced_by")
    for related_name in relationships.get("fusion of", []):
        add_edge(current, related_name, "fusion_of")
    for related_name in relationships.get("has fusion genres", []):
        add_edge(related_name, current, "fusion_of")
    return edges


def fetch_musicbrainz_genre_page_details(mbid: str, *, force: bool = False) -> dict:
    from crate.db import get_mb_cache, set_mb_cache

    cache_key = f"mb:genre:details:v2:{mbid}"
    cached = None if force else get_mb_cache(cache_key)
    if cached:
        return cached

    html_text = ""
    for url in (f"https://musicbrainz.org/genre/{mbid}", f"https://musicbrainz.org/genre/{mbid}/details"):
        try:
            _throttle_musicbrainz()
            html_text = _request_text(url, headers=_mb_headers())
            if html_text:
                break
        except Exception:
            continue

    lines = _strip_musicbrainz_html_to_lines(html_text)
    relationships = _parse_musicbrainz_genre_relationships(lines)
    wikidata_url = ""
    match = re.search(r"https?://www\.wikidata\.org/wiki/(Q\d+)", html_text or "", flags=re.IGNORECASE)
    if match:
        wikidata_url = f"https://www.wikidata.org/wiki/{match.group(1).upper()}"

    result = {
        "musicbrainz_mbid": mbid,
        "wikidata_url": wikidata_url or None,
        "wikidata_entity_id": _extract_wikidata_entity_id(wikidata_url),
        "relationships": relationships,
    }
    set_mb_cache(cache_key, result)
    return result


def _pick_wikidata_description(payload: dict, languages: tuple[str, ...]) -> dict | None:
    entities = payload.get("entities") or {}
    for entity in entities.values():
        descriptions = entity.get("descriptions") or {}
        for language in languages:
            data = descriptions.get(language)
            if not data:
                continue
            value = (data.get("value") or "").strip()
            if value:
                return {"description": value, "language": language}
        for language_code, data in descriptions.items():
            value = (data.get("value") or "").strip()
            if value:
                return {"description": value, "language": language_code}
    return None


def fetch_wikidata_description(entity_id: str, *, force: bool = False, languages: tuple[str, ...] = ("en", "es")) -> dict | None:
    from crate.db import get_cache, set_cache

    entity_id = (entity_id or "").strip().upper()
    if not entity_id:
        return None

    cache_key = f"wikidata:description:{entity_id}:{'|'.join(languages)}"
    cached = None if force else get_cache(cache_key, max_age_seconds=_WIKIDATA_TTL)
    if cached:
        return cached

    payload = _request_json(
        "https://www.wikidata.org/w/api.php",
        params={
            "action": "wbgetentities",
            "ids": entity_id,
            "props": "descriptions",
            "languages": "|".join(languages),
            "format": "json",
        },
        headers={"User-Agent": "crate/1.0 (https://github.com/crate)", "Accept": "application/json"},
    ) or {}
    picked = _pick_wikidata_description(payload, languages)
    if not picked:
        return None

    result = {
        "entity_id": entity_id,
        "description": picked["description"],
        "language": picked["language"],
        "url": f"https://www.wikidata.org/wiki/{entity_id}",
    }
    set_cache(cache_key, result, ttl=_WIKIDATA_TTL)
    return result


def enrich_genre_descriptions_batch(
    *,
    limit: int = 100,
    focus_slug: str | None = None,
    force: bool = False,
    progress_callback: Callable[[dict], None] | None = None,
    event_callback: Callable[[dict], None] | None = None,
) -> dict:
    from crate.db.genres import list_genre_taxonomy_nodes_for_external_enrichment, update_genre_external_metadata

    targets = list_genre_taxonomy_nodes_for_external_enrichment(
        limit=limit,
        focus_slug=focus_slug,
        only_missing_external=not force,
    )
    if not targets:
        return {
            "processed": 0,
            "updated": 0,
            "matched_musicbrainz": 0,
            "matched_wikidata": 0,
            "remaining_without_external": 0,
        }

    mb_index = _musicbrainz_genre_index()
    total = len(targets)
    updated = 0
    matched_musicbrainz = 0
    matched_wikidata = 0
    skipped = 0
    examples_updated: list[dict] = []
    examples_skipped: list[dict] = []

    for index, node in enumerate(targets, start=1):
        slug = (node.get("slug") or "").strip().lower()
        name = (node.get("name") or slug).strip()
        if progress_callback:
            progress_callback(
                {
                    "phase": "genre_descriptions",
                    "done": index - 1,
                    "total": total,
                    "slug": slug,
                    "name": name,
                }
            )

        try:
            match = None
            musicbrainz_mbid = (node.get("musicbrainz_mbid") or "").strip()
            if musicbrainz_mbid:
                match = {"mbid": musicbrainz_mbid, "name": name}
            else:
                match = _find_musicbrainz_match(node, mb_index)
                if match:
                    musicbrainz_mbid = match["mbid"]

            if not musicbrainz_mbid:
                skipped += 1
                if len(examples_skipped) < 8:
                    examples_skipped.append({"slug": slug, "reason": "musicbrainz_match_missing"})
                continue

            matched_musicbrainz += 1
            links = fetch_musicbrainz_genre_external_links(musicbrainz_mbid, force=force)
            update_genre_external_metadata(
                slug,
                musicbrainz_mbid=musicbrainz_mbid,
                wikidata_entity_id=links.get("wikidata_entity_id"),
                wikidata_url=links.get("wikidata_url"),
            )

            wikidata_entity_id = (links.get("wikidata_entity_id") or node.get("wikidata_entity_id") or "").strip()
            if not wikidata_entity_id:
                skipped += 1
                if len(examples_skipped) < 8:
                    examples_skipped.append({"slug": slug, "reason": "wikidata_link_missing", "musicbrainz_mbid": musicbrainz_mbid})
                continue

            wikidata = fetch_wikidata_description(wikidata_entity_id, force=force)
            if not wikidata or not wikidata.get("description"):
                skipped += 1
                if len(examples_skipped) < 8:
                    examples_skipped.append({"slug": slug, "reason": "wikidata_description_missing", "wikidata_entity_id": wikidata_entity_id})
                continue

            description = (wikidata.get("description") or "").strip()
            if _is_low_value_description(description):
                skipped += 1
                if len(examples_skipped) < 8:
                    examples_skipped.append({"slug": slug, "reason": "wikidata_description_too_generic", "description": description})
                continue

            matched_wikidata += 1
            if update_genre_external_metadata(
                slug,
                musicbrainz_mbid=musicbrainz_mbid,
                wikidata_entity_id=wikidata_entity_id,
                wikidata_url=wikidata.get("url"),
                external_description=description,
                external_description_source=f"wikidata:{wikidata.get('language') or 'en'}",
            ):
                updated += 1
                if len(examples_updated) < 8:
                    examples_updated.append(
                        {
                            "slug": slug,
                            "musicbrainz_mbid": musicbrainz_mbid,
                            "wikidata_entity_id": wikidata_entity_id,
                            "description": description,
                        }
                    )
                if event_callback:
                    event_callback(
                        {
                            "message": f"external description updated for {slug}",
                            "slug": slug,
                            "musicbrainz_mbid": musicbrainz_mbid,
                            "wikidata_entity_id": wikidata_entity_id,
                        }
                    )
        except Exception as exc:
            log.warning("Failed to enrich genre description for %s", slug, exc_info=True)
            skipped += 1
            if len(examples_skipped) < 8:
                examples_skipped.append({"slug": slug, "reason": "exception", "error": str(exc)})

    from crate.db.core import get_db_ctx as _get_db_ctx
    with _get_db_ctx() as cur:
        cur.execute("SELECT COUNT(*)::INTEGER AS cnt FROM genre_taxonomy_nodes WHERE external_description IS NULL OR external_description = ''")
        remaining_without_external = cur.fetchone()["cnt"]

    return {
        "processed": total,
        "updated": updated,
        "matched_musicbrainz": matched_musicbrainz,
        "matched_wikidata": matched_wikidata,
        "skipped": skipped,
        "remaining_without_external": remaining_without_external,
        "examples_updated": examples_updated,
        "examples_skipped": examples_skipped,
    }


def sync_musicbrainz_genre_graph_batch(
    *,
    limit: int = 80,
    focus_slug: str | None = None,
    force: bool = False,
    progress_callback: Callable[[dict], None] | None = None,
    event_callback: Callable[[dict], None] | None = None,
) -> dict:
    from crate.db.genres import (
        list_genre_taxonomy_nodes_for_musicbrainz_sync,
        update_genre_external_metadata,
        upsert_genre_taxonomy_edge,
        upsert_genre_taxonomy_node,
    )

    targets = list_genre_taxonomy_nodes_for_musicbrainz_sync(limit=limit, focus_slug=focus_slug)
    if not targets:
        return {
            "processed": 0,
            "matched_musicbrainz": 0,
            "nodes_touched": 0,
            "edges_synced": 0,
            "skipped": 0,
        }

    mb_index = _musicbrainz_genre_index()
    total = len(targets)
    matched_musicbrainz = 0
    touched_node_slugs: set[str] = set()
    edges_synced = 0
    skipped = 0
    examples_synced: list[dict] = []
    examples_skipped: list[dict] = []

    for index, node in enumerate(targets, start=1):
        slug = (node.get("slug") or "").strip().lower()
        name = (node.get("name") or slug).strip().lower()
        if progress_callback:
            progress_callback(
                {
                    "phase": "genre_musicbrainz_graph",
                    "done": index - 1,
                    "total": total,
                    "slug": slug,
                    "name": name,
                }
            )

        try:
            match = None
            musicbrainz_mbid = (node.get("musicbrainz_mbid") or "").strip()
            if musicbrainz_mbid:
                match = {"mbid": musicbrainz_mbid, "name": name}
            else:
                match = _find_musicbrainz_match(node, mb_index)
                if match:
                    musicbrainz_mbid = match["mbid"]

            if not musicbrainz_mbid:
                skipped += 1
                if len(examples_skipped) < 8:
                    examples_skipped.append({"slug": slug, "reason": "musicbrainz_match_missing"})
                continue

            matched_musicbrainz += 1
            current_row = upsert_genre_taxonomy_node(
                slug,
                name=name,
                description=node.get("description") or "",
                is_top_level=bool(node.get("is_top_level")),
                musicbrainz_mbid=musicbrainz_mbid,
            )
            if current_row:
                touched_node_slugs.add(current_row["slug"])

            details = fetch_musicbrainz_genre_page_details(musicbrainz_mbid, force=force)
            update_genre_external_metadata(
                slug,
                musicbrainz_mbid=musicbrainz_mbid,
                wikidata_entity_id=details.get("wikidata_entity_id"),
                wikidata_url=details.get("wikidata_url"),
            )

            relation_edges = _map_musicbrainz_relationships(current_row["name"] if current_row else name, details.get("relationships") or {})
            synced_here = 0
            for relation in relation_edges:
                source_match = mb_index.get(_genre_lookup_key(relation["source_name"]))
                target_match = mb_index.get(_genre_lookup_key(relation["target_name"]))
                source_row = upsert_genre_taxonomy_node(
                    relation["source_name"],
                    name=relation["source_name"],
                    musicbrainz_mbid=source_match["mbid"] if source_match else None,
                )
                target_row = upsert_genre_taxonomy_node(
                    relation["target_name"],
                    name=relation["target_name"],
                    musicbrainz_mbid=target_match["mbid"] if target_match else None,
                )
                if source_row:
                    touched_node_slugs.add(source_row["slug"])
                if target_row:
                    touched_node_slugs.add(target_row["slug"])
                if source_row and target_row and upsert_genre_taxonomy_edge(
                    source_row["slug"],
                    target_row["slug"],
                    relation_type=relation["relation_type"],
                ):
                    synced_here += 1
                    edges_synced += 1

            if len(examples_synced) < 8:
                examples_synced.append(
                    {
                        "slug": slug,
                        "musicbrainz_mbid": musicbrainz_mbid,
                        "edges_synced": synced_here,
                        "relationships": details.get("relationships") or {},
                    }
                )
            if event_callback:
                event_callback(
                    {
                        "message": f"musicbrainz graph synced for {slug}",
                        "slug": slug,
                        "musicbrainz_mbid": musicbrainz_mbid,
                        "edges_synced": synced_here,
                    }
                )
        except Exception as exc:
            log.warning("Failed to sync MusicBrainz graph for %s", slug, exc_info=True)
            skipped += 1
            if len(examples_skipped) < 8:
                examples_skipped.append({"slug": slug, "reason": "exception", "error": str(exc)})

    return {
        "processed": total,
        "matched_musicbrainz": matched_musicbrainz,
        "nodes_touched": len(touched_node_slugs),
        "edges_synced": edges_synced,
        "skipped": skipped,
        "examples_synced": examples_synced,
        "examples_skipped": examples_skipped,
    }
