import os
import logging

import requests

log = logging.getLogger(__name__)


def _base_url() -> str:
    return os.environ.get("NAVIDROME_URL", "http://navidrome:4533")


def _auth_params() -> dict:
    return {
        "u": os.environ.get("NAVIDROME_USER", "admin"),
        "p": os.environ.get("NAVIDROME_PASSWORD", "0n053nd41"),
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
    result = search(name, artist_count=20, album_count=0, song_count=0)
    for artist in result.get("artist", []):
        if artist.get("name", "").lower() == name.lower():
            return artist
    return None


def find_album(artist_name: str, album_name: str) -> dict | None:
    result = search(f"{artist_name} {album_name}", artist_count=0, album_count=20, song_count=0)
    for album in result.get("album", []):
        if album.get("artist", "").lower() == artist_name.lower() and album.get("name", "").lower() == album_name.lower():
            return album
    # Fuzzy: try partial match
    for album in result.get("album", []):
        if album_name.lower() in album.get("name", "").lower() and artist_name.lower() in album.get("artist", "").lower():
            return album
    return None


def stream_song(song_id: str) -> requests.Response:
    return _request_raw("stream", id=song_id)
