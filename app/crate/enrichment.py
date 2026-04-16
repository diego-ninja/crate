"""Unified artist enrichment — fetches all sources and persists to DB."""

import json
import logging
import time
from pathlib import Path

from crate.db import (
    get_cache, set_cache, delete_cache, get_library_artist,
    update_artist_enrichment, get_setting, update_artist_has_photo,
)

log = logging.getLogger(__name__)


def enrich_artist(name: str, config: dict, force: bool = False) -> dict:
    """Full enrichment for a single artist. Fetches all sources, persists to DB, downloads photo.

    Returns dict with source flags (has_lastfm, has_spotify, etc.)
    """
    from crate.lastfm import get_artist_info, get_best_artist_image, get_fanart_all_images
    from crate import spotify, setlistfm, musicbrainz_ext

    lib = Path(config["library_path"])
    db_artist = get_library_artist(name)
    folder = (db_artist.get("folder_name") if db_artist else None) or name
    artist_dir = lib / folder

    # Skip if recently enriched (unless force)
    if not force and db_artist and db_artist.get("enriched_at"):
        from datetime import datetime, timezone
        from crate.utils import to_datetime
        enriched = to_datetime(db_artist["enriched_at"])
        if enriched is not None:
            age_hours = (datetime.now(timezone.utc) - enriched).total_seconds() / 3600
            try:
                min_age = int(get_setting("enrichment_min_age_hours", "24"))
            except (TypeError, ValueError):
                min_age = 24
            if age_hours < min_age:
                return {"artist": name, "skipped": True, "reason": "recently_enriched"}

    if force:
        for prefix in ("enrichment:", "lastfm:artist:", "fanart:artist:",
                        "fanart:bg:", "fanart:all:", "deezer:artist_img:"):
            delete_cache(f"{prefix}{name.lower()}")

    enrichment_data: dict = {}
    persist_data: dict = {}

    # ── Last.fm ──
    try:
        info = get_artist_info(name)
        if info:
            enrichment_data["lastfm"] = info
            persist_data["bio"] = info.get("bio", "")
            persist_data["tags"] = info.get("tags", [])
            persist_data["similar"] = info.get("similar", [])
            persist_data["listeners"] = info.get("listeners")
            persist_data["lastfm_playcount"] = info.get("playcount")
            if info.get("url"):
                persist_data.setdefault("urls", {})["lastfm"] = info["url"]
            # Persist similar artists to dedicated table
            similar_list = info.get("similar", [])
            if similar_list:
                try:
                    from crate.db import bulk_upsert_similarities
                    bulk_upsert_similarities(name, similar_list)
                except Exception:
                    log.debug("Failed to persist similarities for %s", name)
    except Exception:
        log.debug("Last.fm failed for %s", name)
    time.sleep(0.3)

    # ── Spotify ──
    try:
        sp = spotify.search_artist(name)
        if sp:
            spotify_data = {
                "popularity": sp.get("popularity"),
                "followers": sp.get("followers"),
                "genres": sp.get("genres", []),
                "url": sp.get("url"),
            }
            persist_data["spotify_id"] = sp.get("id")
            persist_data["spotify_popularity"] = sp.get("popularity")
            persist_data["spotify_followers"] = sp.get("followers")
            if sp.get("url"):
                persist_data.setdefault("urls", {})["spotify"] = sp["url"]

            # Merge Spotify genres into tags
            sp_genres = sp.get("genres", [])
            if sp_genres:
                existing_tags = persist_data.get("tags", [])
                merged = list(dict.fromkeys(existing_tags + sp_genres))
                persist_data["tags"] = merged

            try:
                top = spotify.get_top_tracks(sp["id"])
                spotify_data["top_tracks"] = top or []
            except Exception:
                spotify_data["top_tracks"] = []
            try:
                related = spotify.get_related_artists(sp["id"])
                spotify_data["related_artists"] = related or []
                # Merge into similar if empty
                if not persist_data.get("similar") and related:
                    persist_data["similar"] = [{"name": r["name"]} for r in related[:10]]
            except Exception:
                spotify_data["related_artists"] = []
            enrichment_data["spotify"] = spotify_data
    except Exception:
        log.debug("Spotify failed for %s", name)
    time.sleep(0.3)

    # ── MusicBrainz ──
    try:
        mb = musicbrainz_ext.get_artist_details(name)
        if mb:
            enrichment_data["musicbrainz"] = mb
            persist_data["mbid"] = mb.get("mbid")
            persist_data["country"] = mb.get("country")
            persist_data["area"] = mb.get("area")
            persist_data["formed"] = mb.get("begin_date")
            persist_data["ended"] = mb.get("end_date")
            persist_data["artist_type"] = mb.get("type")
            persist_data["members"] = mb.get("members", [])
            # Merge MB urls with any already collected (Last.fm, Spotify)
            mb_urls = mb.get("urls", {})
            existing_urls = persist_data.get("urls", {})
            persist_data["urls"] = {**mb_urls, **existing_urls}
    except Exception:
        log.debug("MusicBrainz failed for %s", name)
    time.sleep(0.3)

    # ── Setlist.fm ──
    try:
        setlist = setlistfm.get_probable_setlist(name)
        if setlist:
            enrichment_data["setlist"] = {
                "probable_setlist": setlist,
                "total_shows": len(setlist),
            }
    except Exception:
        log.debug("Setlist.fm failed for %s", name)
    time.sleep(0.3)

    # ── Fanart.tv ──
    try:
        fanart = get_fanart_all_images(name)
        if fanart:
            enrichment_data["fanart"] = fanart
    except Exception:
        log.debug("Fanart.tv failed for %s", name)

    # ── Discogs ──
    try:
        from crate.discogs import enrich_artist as discogs_enrich, is_configured as discogs_configured
        if discogs_configured():
            dc = discogs_enrich(name)
            if dc:
                enrichment_data["discogs"] = dc
                if dc.get("discogs_id"):
                    persist_data["discogs_id"] = str(dc["discogs_id"])
                if dc.get("discogs_profile"):
                    persist_data["discogs_profile"] = dc["discogs_profile"][:2000]
                if dc.get("discogs_members"):
                    persist_data["discogs_members"] = dc["discogs_members"]
                if dc.get("discogs_url"):
                    persist_data.setdefault("urls", {})["discogs"] = dc["discogs_url"]
    except Exception:
        log.debug("Discogs failed for %s", name)
    time.sleep(0.3)

    # ── Persist to cache ──
    if enrichment_data:
        set_cache(f"enrichment:{name.lower()}", enrichment_data)

    # ── Persist to DB ──
    if persist_data:
        try:
            update_artist_enrichment(name, persist_data)
        except Exception:
            log.warning("Failed to persist enrichment for %s", name, exc_info=True)

    # ── Update genre index ──
    tags = persist_data.get("tags", [])
    if tags:
        try:
            from crate.db import set_artist_genres
            genres = []
            for j, tag in enumerate(tags):
                tag = tag.strip()
                if tag and len(tag) >= 2:
                    weight = max(0.1, 1.0 - j * 0.12)
                    genres.append((tag, weight, "enrichment"))
            if genres:
                set_artist_genres(name, genres)
        except Exception:
            log.debug("Failed to index genres for %s", name)

    # ── Download photo ──
    has_photo = artist_dir.is_dir() and any(
        (artist_dir / p).exists() for p in ("artist.jpg", "artist.png", "photo.jpg")
    )
    if not has_photo and artist_dir.is_dir():
        try:
            img = get_best_artist_image(name)
            if img:
                (artist_dir / "artist.jpg").write_bytes(img)
                update_artist_has_photo(name)
        except OSError:
            pass
        time.sleep(0.3)

    return {
        "artist": name,
        "has_lastfm": "lastfm" in enrichment_data,
        "has_spotify": "spotify" in enrichment_data,
        "has_setlist": "setlist" in enrichment_data,
        "has_musicbrainz": "musicbrainz" in enrichment_data,
        "has_fanart": "fanart" in enrichment_data,
        "has_discogs": "discogs" in enrichment_data,
    }
