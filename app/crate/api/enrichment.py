import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from thefuzz import fuzz

from crate.api.auth import _require_admin
from crate.api._deps import artist_name_from_id
from crate import spotify, setlistfm, musicbrainz_ext, navidrome
from crate.db import get_db_ctx
from crate.lastfm import get_artist_info, get_fanart_all_images

log = logging.getLogger(__name__)

router = APIRouter()


def _enrich_artist_refs(items: list[dict]) -> list[dict]:
    names = [item.get("name") for item in items if item.get("name")]
    if not names:
        return items

    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT id, slug, name
            FROM library_artists
            WHERE LOWER(name) = ANY(%s)
            """,
            ([name.lower() for name in names],),
        )
        refs = {
            row["name"].lower(): {"id": row.get("id"), "slug": row.get("slug")}
            for row in cur.fetchall()
        }

    enriched: list[dict] = []
    for item in items:
        current = dict(item)
        ref = refs.get((current.get("name") or "").lower())
        if ref:
            current.setdefault("id", ref.get("id"))
            current.setdefault("slug", ref.get("slug"))
        enriched.append(current)
    return enriched


def _enrich_enrichment_artist_refs(result: dict) -> dict:
    enriched = dict(result or {})

    lastfm = dict(enriched.get("lastfm") or {})
    if isinstance(lastfm.get("similar"), list):
        lastfm["similar"] = _enrich_artist_refs(lastfm["similar"])
    if lastfm:
        enriched["lastfm"] = lastfm

    spotify_data = dict(enriched.get("spotify") or {})
    if isinstance(spotify_data.get("related_artists"), list):
        spotify_data["related_artists"] = _enrich_artist_refs(spotify_data["related_artists"])
    if spotify_data:
        enriched["spotify"] = spotify_data

    return enriched


def get_artist_enrichment(request: Request, name: str):
    """Get consolidated enrichment data. Returns cached if available, otherwise fetches inline.
    For background enrichment, use POST /api/artists/{artist_id}/enrich which queues a worker task."""
    _require_admin(request)
    from crate.db import get_cache, set_cache, get_library_artist

    # Try cache first
    cache_key = f"enrichment:{name.lower()}"
    cached = get_cache(cache_key, max_age_seconds=86400)
    if cached:
        enriched_cached = _enrich_enrichment_artist_refs(cached)
        set_cache(cache_key, enriched_cached)
        return enriched_cached

    # Try DB persisted data as fallback (survives cache expiry)
    db_artist = get_library_artist(name)
    if db_artist and db_artist.get("enriched_at"):
        result = _enrich_enrichment_artist_refs(_build_from_db(db_artist))
        if result:
            set_cache(cache_key, result)
            return result

    # Fetch inline (first visit)
    result = _enrich_enrichment_artist_refs(_fetch_enrichment(name))
    if result:
        # Only cache if we got meaningful data (at least lastfm or spotify)
        if "lastfm" in result or "spotify" in result:
            set_cache(cache_key, result)
    return result or {}


@router.get("/api/artists/{artist_id}/enrichment")
def get_artist_enrichment_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return get_artist_enrichment(request, artist_name)


def _build_from_db(artist: dict) -> dict:
    """Reconstruct enrichment dict from persisted DB columns."""
    import json
    result: dict = {}

    bio = artist.get("bio")
    tags = artist.get("tags_json")
    similar = artist.get("similar_json")
    listeners = artist.get("listeners")
    if bio or tags or listeners or similar:
        lastfm: dict = {}
        if bio:
            lastfm["bio"] = bio
        if tags:
            lastfm["tags"] = tags if isinstance(tags, list) else json.loads(tags or "[]")
        if similar:
            lastfm["similar"] = similar if isinstance(similar, list) else json.loads(similar or "[]")
        if listeners:
            lastfm["listeners"] = listeners
        result["lastfm"] = lastfm

    if artist.get("spotify_id"):
        result["spotify"] = {
            "popularity": artist.get("spotify_popularity"),
        }

    mbid = artist.get("mbid")
    if mbid:
        mb: dict = {"mbid": mbid}
        if artist.get("country"):
            mb["country"] = artist["country"]
        if artist.get("area"):
            mb["area"] = artist["area"]
        if artist.get("formed"):
            mb["begin_date"] = artist["formed"]
        if artist.get("ended"):
            mb["end_date"] = artist["ended"]
        if artist.get("artist_type"):
            mb["type"] = artist["artist_type"]
        members = artist.get("members_json")
        if members:
            mb["members"] = members if isinstance(members, list) else json.loads(members or "[]")
        urls = artist.get("urls_json")
        if urls:
            mb["urls"] = urls if isinstance(urls, dict) else json.loads(urls or "{}")
        result["musicbrainz"] = mb

    # Setlist.fm (from its own cache, not stored in DB)
    try:
        setlist_data = setlistfm.get_probable_setlist(artist.get("name", ""))
        if setlist_data:
            result["setlist"] = {
                "probable_setlist": setlist_data,
                "total_shows": len(setlist_data),
            }
    except Exception:
        pass

    return result


def _fetch_enrichment(name: str) -> dict:
    result: dict = {}

    # Last.fm
    try:
        info = get_artist_info(name)
        if info:
            result["lastfm"] = info
    except Exception:
        log.debug("Last.fm enrichment failed for %s", name)

    # Spotify
    try:
        sp = spotify.search_artist(name)
        if sp:
            spotify_data = {
                "popularity": sp.get("popularity"),
                "followers": sp.get("followers"),
                "genres": sp.get("genres", []),
                "url": sp.get("url"),
            }
            try:
                top = spotify.get_top_tracks(sp["id"])
                spotify_data["top_tracks"] = top or []
            except Exception:
                spotify_data["top_tracks"] = []
            try:
                related = spotify.get_related_artists(sp["id"])
                spotify_data["related_artists"] = related or []
            except Exception:
                spotify_data["related_artists"] = []
            result["spotify"] = spotify_data
    except Exception:
        log.debug("Spotify enrichment failed for %s", name)

    # Setlist.fm
    try:
        setlist = setlistfm.get_probable_setlist(name)
        if setlist:
            result["setlist"] = {
                "probable_setlist": setlist,
                "total_shows": len(setlist),
            }
    except Exception:
        log.debug("Setlist.fm enrichment failed for %s", name)

    # MusicBrainz extended
    try:
        mb = musicbrainz_ext.get_artist_details(name)
        if mb:
            result["musicbrainz"] = mb
    except Exception:
        log.debug("MusicBrainz enrichment failed for %s", name)

    # Fanart.tv all images
    try:
        fanart = get_fanart_all_images(name)
        if fanart:
            result["fanart"] = fanart
    except Exception:
        log.debug("Fanart.tv enrichment failed for %s", name)

    return result


def create_setlist_playlist(request: Request, name: str):
    _require_admin(request)
    setlist = setlistfm.get_probable_setlist(name)
    if not setlist:
        return JSONResponse({"error": "No setlist data found"}, status_code=404)

    matched_ids: list[str] = []
    unmatched: list[str] = []

    for song in setlist:
        title = song["title"]
        try:
            results = navidrome.search(f"{name} {title}", artist_count=0, album_count=0, song_count=10)
            songs = results.get("song", [])

            best_match = None
            best_score = 0
            for s in songs:
                artist_score = fuzz.ratio(name.lower(), s.get("artist", "").lower())
                title_score = fuzz.ratio(title.lower(), s.get("title", "").lower())
                score = (artist_score + title_score) // 2
                if score > best_score:
                    best_score = score
                    best_match = s

            if best_match and best_score >= 70:
                matched_ids.append(best_match["id"])
            else:
                unmatched.append(title)
        except Exception:
            unmatched.append(title)

    if not matched_ids:
        return JSONResponse({"error": "No songs matched in library"}, status_code=404)

    playlist_name = f"{name} - Probable Setlist"
    try:
        playlist_id = navidrome.create_playlist(playlist_name, matched_ids)
    except Exception:
        return JSONResponse({"error": "Failed to create playlist"}, status_code=500)

    return {
        "playlist_id": playlist_id,
        "playlist_name": playlist_name,
        "matched": len(matched_ids),
        "unmatched": unmatched,
        "total_setlist": len(setlist),
    }


@router.post("/api/artists/{artist_id}/setlist-playlist")
def create_setlist_playlist_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return create_setlist_playlist(request, artist_name)
