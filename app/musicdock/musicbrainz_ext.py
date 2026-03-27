import logging

import musicbrainzngs

from musicdock.db import get_cache, set_cache

log = logging.getLogger(__name__)



def _search_mbid(name: str) -> str | None:
    from thefuzz import fuzz
    try:
        result = musicbrainzngs.search_artists(artist=name, limit=5)
        artists = result.get("artist-list", [])
        # Find best match by name similarity (avoid Black Curse -> Black Sabbath)
        for a in artists:
            mb_name = a.get("name", "")
            if fuzz.ratio(name.lower(), mb_name.lower()) >= 80:
                return a["id"]
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


def get_artist_releases(mbid: str) -> list[dict]:
    """Get all release groups (albums, EPs, singles) for an artist by MBID.
    Returns list sorted by date descending."""
    cache_key = f"mb:releases:{mbid}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    try:
        all_releases = []
        offset = 0
        max_pages = 5  # safety limit
        page = 0
        while page < max_pages:
            page += 1
            try:
                result = musicbrainzngs.browse_release_groups(
                    artist=mbid, release_type=["album", "ep"],
                    limit=100, offset=offset,
                )
            except musicbrainzngs.ResponseError:
                log.debug("MB 404/error for MBID %s, skipping", mbid)
                set_cache(cache_key, [], ttl=86400)  # cache empty for 24h
                return []
            groups = result.get("release-group-list", [])
            if not groups:
                break
            for rg in groups:
                title = rg.get("title", "")
                rg_type = rg.get("primary-type", "Album")
                first_release = rg.get("first-release-date", "")
                year = first_release[:4] if first_release else ""
                all_releases.append({
                    "title": title,
                    "year": year,
                    "type": rg_type,
                    "mbid": rg.get("id", ""),
                    "first_release_date": first_release,
                })
            offset += len(groups)
            if offset >= int(result.get("release-group-count", 0)):
                break

        all_releases.sort(key=lambda r: r.get("first_release_date", ""), reverse=True)
        set_cache(cache_key, all_releases, ttl=86400)  # 24h
        return all_releases
    except Exception:
        log.debug("MB releases failed for %s", mbid, exc_info=True)
        return []
