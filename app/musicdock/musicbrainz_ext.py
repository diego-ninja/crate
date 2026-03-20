import logging

import musicbrainzngs

from musicdock.db import get_cache, set_cache

log = logging.getLogger(__name__)

musicbrainzngs.set_useragent("musicdock-librarian", "0.1", "https://github.com/musicdock")


def _search_mbid(name: str) -> str | None:
    try:
        result = musicbrainzngs.search_artists(artist=name, limit=1)
        artists = result.get("artist-list", [])
        if artists:
            return artists[0]["id"]
    except Exception:
        log.debug("MB artist search failed for %s", name)
    return None


def get_artist_details(name: str) -> dict | None:
    cache_key = f"mb:detail:{name.lower()}"
    cached = get_cache(cache_key, max_age_seconds=86400)
    if cached:
        return cached

    mbid = _search_mbid(name)
    if not mbid:
        return None

    try:
        artist = musicbrainzngs.get_artist_by_id(
            mbid, includes=["url-rels", "artist-rels"]
        )["artist"]
    except Exception:
        log.debug("MB artist details failed for %s", name)
        return None

    life_span = artist.get("life-span", {})

    members = []
    for rel in artist.get("artist-relation-list", []):
        if rel.get("type") in ("member of band", "is person"):
            member = {
                "name": rel.get("artist", {}).get("name", ""),
                "type": rel.get("type", ""),
                "begin": rel.get("begin", ""),
                "end": rel.get("end", ""),
                "attributes": rel.get("attribute-list", []),
            }
            members.append(member)

    urls: dict[str, str] = {}
    url_type_map = {
        "wikipedia": "wikipedia",
        "official homepage": "official",
        "wikidata": "wikidata",
        "allmusic": "allmusic",
        "discogs": "discogs",
        "BBC Music page": "bbc",
        "streaming music": "spotify",
    }
    for rel in artist.get("url-relation-list", []):
        rel_type = rel.get("type", "")
        url = rel.get("target", "")
        mapped = url_type_map.get(rel_type)
        if mapped:
            urls[mapped] = url
        elif "spotify" in url:
            urls["spotify"] = url

    result = {
        "mbid": mbid,
        "type": artist.get("type", ""),
        "begin_date": life_span.get("begin", ""),
        "end_date": life_span.get("end", ""),
        "country": artist.get("country", ""),
        "area": artist.get("area", {}).get("name", ""),
        "disambiguation": artist.get("disambiguation", ""),
        "members": members,
        "urls": urls,
    }

    set_cache(cache_key, result)
    return result
