import logging

from musicdock import navidrome
from musicdock.lastfm import get_artist_info

log = logging.getLogger(__name__)


def generate_by_genre(genre: str, limit: int = 50) -> list[str]:
    songs = navidrome.get_songs_by_genre(genre, count=limit)
    return [s["id"] for s in songs]


def generate_by_decade(decade: int, limit: int = 50) -> list[str]:
    year_start = decade
    year_end = decade + 9
    songs = navidrome.get_random_songs(size=500)
    matching = [
        s for s in songs
        if year_start <= (s.get("year") or 0) <= year_end
    ]
    return [s["id"] for s in matching[:limit]]


def generate_by_artist(artist_name: str, limit: int = 50) -> list[str]:
    artist = navidrome.find_artist_by_name(artist_name)
    if not artist:
        return []
    full = navidrome.get_artist(artist["id"])
    song_ids = []
    for album_entry in full.get("album", []):
        album = navidrome.get_album(album_entry["id"])
        for song in album.get("song", []):
            song_ids.append(song["id"])
            if len(song_ids) >= limit:
                return song_ids
    return song_ids


def generate_similar_artists(artist_name: str, limit: int = 50) -> list[str]:
    info = get_artist_info(artist_name)
    if not info or not info.get("similar"):
        return []
    song_ids = []
    for sim in info["similar"]:
        sim_name = sim.get("name", "")
        if not sim_name:
            continue
        artist = navidrome.find_artist_by_name(sim_name)
        if not artist:
            continue
        top = navidrome.get_top_songs(sim_name, count=10)
        for song in top:
            song_ids.append(song["id"])
            if len(song_ids) >= limit:
                return song_ids
    return song_ids


def generate_random(limit: int = 50) -> list[str]:
    songs = navidrome.get_random_songs(size=limit)
    return [s["id"] for s in songs]
