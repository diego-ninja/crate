import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from thefuzz import fuzz

from musicdock import spotify, setlistfm, musicbrainz_ext, navidrome
from musicdock.lastfm import get_fanart_all_images

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/api/artist/{name}/enrichment")
def get_artist_enrichment(name: str):
    result: dict = {"artist": name}

    # Spotify
    try:
        sp = spotify.search_artist(name)
        if sp:
            result["spotify"] = sp
            top = spotify.get_top_tracks(sp["id"])
            if top:
                result["spotify_top_tracks"] = top
            related = spotify.get_related_artists(sp["id"])
            if related:
                result["spotify_related"] = related
    except Exception:
        log.debug("Spotify enrichment failed for %s", name)

    # Setlist.fm
    try:
        setlist = setlistfm.get_probable_setlist(name)
        if setlist:
            result["probable_setlist"] = setlist
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


@router.post("/api/artist/{name}/setlist-playlist")
def create_setlist_playlist(name: str):
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
