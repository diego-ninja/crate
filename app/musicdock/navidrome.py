import os
import logging

import requests
from thefuzz import fuzz

from musicdock.db import get_cache, set_cache

log = logging.getLogger(__name__)


def _base_url() -> str:
    return os.environ.get("NAVIDROME_URL", "http://navidrome:4533")


def _auth_params() -> dict:
    return {
        "u": os.environ.get("NAVIDROME_USER", "admin"),
        "p": os.environ.get("NAVIDROME_PASSWORD", ""),
        "v": "1.16.1",
        "c": "librarian",
        "f": "json",
    }


def _request(endpoint: str, **params) -> dict:
    url = f"{_base_url()}/rest/{endpoint}"
    all_params = {**_auth_params(), **params}
    resp = requests.get(url, params=all_params, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    sr = data.get("subsonic-response", {})
    if sr.get("status") != "ok":
        raise RuntimeError(f"Subsonic error: {sr.get('error', {}).get('message', 'unknown')}")
    return sr


def _request_raw(endpoint: str, **params) -> requests.Response:
    url = f"{_base_url()}/rest/{endpoint}"
    all_params = {**_auth_params(), **params}
    resp = requests.get(url, params=all_params, timeout=30, stream=True)
    resp.raise_for_status()
    return resp


def ping() -> bool:
    try:
        sr = _request("ping")
        return sr.get("status") == "ok"
    except Exception:
        return False


def get_server_version() -> str | None:
    try:
        sr = _request("ping")
        return sr.get("version")
    except Exception:
        return None


def search(query: str, artist_count: int = 20, album_count: int = 20, song_count: int = 20) -> dict:
    sr = _request("search3", query=query, artistCount=artist_count, albumCount=album_count, songCount=song_count)
    return sr.get("searchResult3", {})


def get_artists() -> list:
    sr = _request("getArtists")
    indexes = sr.get("artists", {}).get("index", [])
    artists = []
    for idx in indexes:
        artists.extend(idx.get("artist", []))
    return artists


def get_artist(artist_id: str) -> dict:
    sr = _request("getArtist", id=artist_id)
    return sr.get("artist", {})


def get_album(album_id: str) -> dict:
    sr = _request("getAlbum", id=album_id)
    return sr.get("album", {})


def get_playlists() -> list:
    sr = _request("getPlaylists")
    return sr.get("playlists", {}).get("playlist", [])


def create_playlist(name: str, song_ids: list[str]) -> str:
    url = f"{_base_url()}/rest/createPlaylist"
    params = {**_auth_params(), "name": name}
    # songId can appear multiple times
    param_list = list(params.items()) + [("songId", sid) for sid in song_ids]
    resp = requests.get(url, params=param_list, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    sr = data.get("subsonic-response", {})
    playlist = sr.get("playlist", {})
    return playlist.get("id", "")


def delete_playlist(playlist_id: str):
    _request("deletePlaylist", id=playlist_id)


def get_random_songs(size: int = 50, genre: str | None = None) -> list:
    params = {"size": size}
    if genre:
        params["genre"] = genre
    sr = _request("getRandomSongs", **params)
    return sr.get("randomSongs", {}).get("song", [])


def get_songs_by_genre(genre: str, count: int = 50, offset: int = 0) -> list:
    sr = _request("getSongsByGenre", genre=genre, count=count, offset=offset)
    return sr.get("songsByGenre", {}).get("song", [])


def get_top_songs(artist_name: str, count: int = 50) -> list:
    sr = _request("getTopSongs", artist=artist_name, count=count)
    return sr.get("topSongs", {}).get("song", [])


def find_artist_by_name(name: str) -> dict | None:
    cache_key = f"nd:artist:{name.lower()}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    result = search(name, artist_count=20, album_count=0, song_count=0)
    artists = result.get("artist", [])

    # Exact match
    for artist in artists:
        if artist.get("name", "").lower() == name.lower():
            set_cache(cache_key, artist)
            return artist

    # Fuzzy match
    best_score = 0
    best_artist = None
    for artist in artists:
        score = fuzz.ratio(name.lower(), artist.get("name", "").lower())
        if score > best_score:
            best_score = score
            best_artist = artist

    if best_artist and best_score >= 80:
        set_cache(cache_key, best_artist)
        return best_artist

    return None


def _strip_year_prefix(name: str) -> str:
    """Remove 'YYYY - ' prefix from album names (folder naming convention)."""
    import re
    return re.sub(r"^\d{4}\s*-\s*", "", name)


def find_album(artist_name: str, album_name: str,
               tag_album: str | None = None, mbid: str | None = None) -> dict | None:
    cache_key = f"nd:album:{artist_name.lower()}:{album_name.lower()}"
    cached = get_cache(cache_key)
    if cached:
        return cached

    # Best name to search with: tag_album (from audio tags) > stripped folder name
    clean_name = tag_album or _strip_year_prefix(album_name)

    result = search(f"{artist_name} {clean_name}", artist_count=0, album_count=20, song_count=0)
    albums = result.get("album", [])

    # 1. MBID exact match (most reliable)
    if mbid:
        for album in albums:
            if album.get("musicBrainzId") == mbid:
                set_cache(cache_key, album)
                return album

    clean_lower = clean_name.lower()

    # 2. Exact name match (tag_album, stripped name, or original)
    for album in albums:
        nd_name = album.get("name", "").lower()
        nd_artist = album.get("artist", "").lower()
        if nd_artist == artist_name.lower() and (
            nd_name == clean_lower
            or nd_name == album_name.lower()
            or (tag_album and nd_name == tag_album.lower())
        ):
            set_cache(cache_key, album)
            return album

    # 3. Fuzzy match (use tag_album or clean name for best scores)
    best_score = 0
    best_album = None
    for album in albums:
        artist_score = fuzz.ratio(artist_name.lower(), album.get("artist", "").lower())
        album_score = max(
            fuzz.ratio(clean_lower, album.get("name", "").lower()),
            fuzz.ratio(album_name.lower(), album.get("name", "").lower()),
        )
        score = (artist_score + album_score) // 2
        if score > best_score:
            best_score = score
            best_album = album

    if best_album and best_score >= 75:
        set_cache(cache_key, best_album)
        return best_album

    return None


def star(item_id: str, item_type: str = "song") -> bool:
    """Star (favorite) an item. item_type: song, album, artist."""
    params = {}
    if item_type == "song":
        params["id"] = item_id
    elif item_type == "album":
        params["albumId"] = item_id
    elif item_type == "artist":
        params["artistId"] = item_id
    try:
        _request("star", **params)
        return True
    except Exception:
        log.warning("Failed to star %s %s", item_type, item_id, exc_info=True)
        return False


def unstar(item_id: str, item_type: str = "song") -> bool:
    """Unstar an item."""
    params = {}
    if item_type == "song":
        params["id"] = item_id
    elif item_type == "album":
        params["albumId"] = item_id
    elif item_type == "artist":
        params["artistId"] = item_id
    try:
        _request("unstar", **params)
        return True
    except Exception:
        log.warning("Failed to unstar %s %s", item_type, item_id, exc_info=True)
        return False


def get_starred() -> dict:
    """Get all starred items."""
    try:
        sr = _request("getStarred2")
        starred = sr.get("starred2", {})
        return {
            "songs": starred.get("song", []),
            "albums": starred.get("album", []),
            "artists": starred.get("artist", []),
        }
    except Exception:
        log.warning("Failed to get starred items", exc_info=True)
        return {"songs": [], "albums": [], "artists": []}


def scrobble(song_id: str) -> bool:
    """Report a song as played (scrobble)."""
    try:
        _request("scrobble", id=song_id, submission="true")
        return True
    except Exception:
        log.warning("Failed to scrobble %s", song_id, exc_info=True)
        return False


def get_album_list(list_type: str, size: int = 20, offset: int = 0) -> list[dict]:
    """Get album list. Types: newest, highest, frequent, recent, starred, random."""
    try:
        sr = _request("getAlbumList2", type=list_type, size=size, offset=offset)
        return sr.get("albumList2", {}).get("album", [])
    except Exception:
        log.warning("Failed to get album list %s", list_type, exc_info=True)
        return []


def update_playlist(playlist_id: str, name: str | None = None,
                    song_ids_to_add: list[str] | None = None,
                    song_indexes_to_remove: list[int] | None = None) -> bool:
    """Update a playlist: rename, add songs, remove songs by index."""
    url = f"{_base_url()}/rest/updatePlaylist"
    params = {**_auth_params(), "playlistId": playlist_id}
    if name:
        params["name"] = name
    # Build param list for repeated params (same pattern as create_playlist)
    param_list = list(params.items())
    if song_ids_to_add:
        param_list.extend([("songIdToAdd", sid) for sid in song_ids_to_add])
    if song_indexes_to_remove:
        param_list.extend([("songIndexToRemove", idx) for idx in song_indexes_to_remove])
    try:
        resp = requests.get(url, params=param_list, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        sr = data.get("subsonic-response", {})
        return sr.get("status") == "ok"
    except Exception:
        log.warning("Failed to update playlist %s", playlist_id, exc_info=True)
        return False


def get_playlist(playlist_id: str) -> dict | None:
    """Get a single playlist with all its tracks."""
    try:
        sr = _request("getPlaylist", id=playlist_id)
        return sr.get("playlist", None)
    except Exception:
        log.warning("Failed to get playlist %s", playlist_id, exc_info=True)
        return None


def map_library_ids() -> dict:
    """Bulk-map local library to Navidrome IDs. Returns counts."""
    import time as _time
    from musicdock.db import get_db_ctx

    mapped_artists = 0
    mapped_albums = 0
    mapped_tracks = 0

    # Map artists
    nd_artists = get_artists()
    if nd_artists:
        with get_db_ctx() as cur:
            for a in nd_artists:
                nd_id = a.get("id", "")
                nd_name = a.get("name", "")
                if nd_id and nd_name:
                    cur.execute(
                        "UPDATE library_artists SET navidrome_id = %s WHERE LOWER(name) = LOWER(%s) AND navidrome_id IS NULL",
                        (nd_id, nd_name),
                    )
                    mapped_artists += cur.rowcount

    # Map albums (for each artist with navidrome_id)
    with get_db_ctx() as cur:
        cur.execute("SELECT name, navidrome_id FROM library_artists WHERE navidrome_id IS NOT NULL")
        artists_with_id = cur.fetchall()

    for artist_row in artists_with_id:
        try:
            nd_artist = get_artist(artist_row["navidrome_id"])
            if not nd_artist:
                continue
            nd_albums = nd_artist.get("album", [])
            for nd_album in nd_albums:
                nd_album_id = nd_album.get("id", "")
                nd_album_name = nd_album.get("name", "")
                if nd_album_id and nd_album_name:
                    with get_db_ctx() as cur:
                        cur.execute(
                            "UPDATE library_albums SET navidrome_id = %s WHERE LOWER(artist) = LOWER(%s) AND (LOWER(name) = LOWER(%s) OR name ILIKE %s) AND navidrome_id IS NULL",
                            (nd_album_id, artist_row["name"], nd_album_name, f"% - {nd_album_name}"),
                        )
                        mapped_albums += cur.rowcount

                # Map tracks within album
                try:
                    nd_album_detail = get_album(nd_album_id)
                    if nd_album_detail:
                        for nd_song in nd_album_detail.get("song", []):
                            nd_song_id = nd_song.get("id", "")
                            nd_song_title = nd_song.get("title", "")
                            if nd_song_id and nd_song_title:
                                with get_db_ctx() as cur:
                                    cur.execute(
                                        "UPDATE library_tracks SET navidrome_id = %s WHERE LOWER(title) = LOWER(%s) AND LOWER(artist) = LOWER(%s) AND navidrome_id IS NULL",
                                        (nd_song_id, nd_song_title, artist_row["name"]),
                                    )
                                    mapped_tracks += cur.rowcount
                except Exception:
                    pass
            _time.sleep(0.2)  # Rate limit
        except Exception:
            pass

    return {"artists": mapped_artists, "albums": mapped_albums, "tracks": mapped_tracks}


def stream_song(song_id: str) -> requests.Response:
    return _request_raw("stream", id=song_id)


def start_scan() -> bool:
    try:
        _request("startScan")
        return True
    except Exception:
        log.warning("Failed to trigger Navidrome scan", exc_info=True)
        return False


def get_scan_status() -> dict:
    try:
        sr = _request("getScanStatus")
        status = sr.get("scanStatus", {})
        return {
            "scanning": status.get("scanning", False),
            "count": status.get("count", 0),
        }
    except Exception:
        return {"scanning": False, "count": 0}
