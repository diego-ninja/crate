"""Missing albums: cross-reference local library with MusicBrainz discography."""

import logging
from pathlib import Path

import musicbrainzngs

from musicdock.audio import get_audio_files, read_tags

log = logging.getLogger(__name__)

musicbrainzngs.set_useragent("musicdock-librarian", "0.1", "https://github.com/musicdock")


def find_missing_albums(artist_dir: Path, extensions: set[str]) -> dict:
    """Compare local albums with MusicBrainz discography for an artist."""
    local_albums = []
    for album_dir in sorted(artist_dir.iterdir()):
        if not album_dir.is_dir() or album_dir.name.startswith("."):
            continue
        tracks = get_audio_files(album_dir, extensions)
        if not tracks:
            continue

        tags = read_tags(tracks[0])
        local_albums.append({
            "name": album_dir.name,
            "album_tag": tags.get("album", ""),
            "mbid": tags.get("musicbrainz_albumid"),
            "track_count": len(tracks),
        })

    if not local_albums:
        return {"artist": artist_dir.name, "local": [], "missing": [], "error": "No local albums"}

    # Try to find artist on MusicBrainz
    artist_name = artist_dir.name
    mb_artist = _find_mb_artist(artist_name)
    if not mb_artist:
        return {"artist": artist_name, "local": local_albums, "missing": [], "error": "Artist not found on MB"}

    # Get discography
    mb_albums = _get_discography(mb_artist["id"])

    # Match local vs MB
    local_names = {_normalize(a["album_tag"] or a["name"]) for a in local_albums}
    local_mbids = {a["mbid"] for a in local_albums if a["mbid"]}

    missing = []
    for mb_album in mb_albums:
        mb_name_norm = _normalize(mb_album["title"])
        # Skip if we have it by MBID or by name
        if mb_album.get("release_group_id") and any(
            a.get("mbid") == mb_album.get("release_group_id") for a in local_albums
        ):
            continue
        if mb_name_norm in local_names:
            continue
        # Fuzzy name check
        if any(_is_similar(mb_name_norm, ln) for ln in local_names):
            continue

        missing.append(mb_album)

    return {
        "artist": artist_name,
        "mb_artist_id": mb_artist["id"],
        "mb_artist_name": mb_artist["name"],
        "local_count": len(local_albums),
        "mb_count": len(mb_albums),
        "missing_count": len(missing),
        "local": local_albums,
        "missing": missing,
    }


def _find_mb_artist(name: str) -> dict | None:
    try:
        result = musicbrainzngs.search_artists(artist=name, limit=5)
        for a in result.get("artist-list", []):
            score = int(a.get("ext:score", 0))
            if score >= 90:
                return {"id": a["id"], "name": a["name"]}
        # Fallback: first result with score >= 70
        for a in result.get("artist-list", []):
            if int(a.get("ext:score", 0)) >= 70:
                return {"id": a["id"], "name": a["name"]}
    except Exception as e:
        log.error("MB artist search failed for %s: %s", name, e)
    return None


def _get_discography(artist_id: str) -> list[dict]:
    """Get official album release groups for an artist."""
    albums = []
    try:
        offset = 0
        while True:
            result = musicbrainzngs.browse_release_groups(
                artist=artist_id,
                release_type=["album"],
                limit=100,
                offset=offset,
            )
            groups = result.get("release-group-list", [])
            if not groups:
                break

            for rg in groups:
                # Only official albums (skip compilations, singles, etc)
                primary = rg.get("primary-type", "")
                secondary = rg.get("secondary-type-list", [])
                if primary != "Album" or secondary:
                    continue

                albums.append({
                    "release_group_id": rg["id"],
                    "title": rg["title"],
                    "type": primary,
                    "first_release_date": rg.get("first-release-date", ""),
                })

            offset += len(groups)
            if offset >= int(result.get("release-group-count", 0)):
                break
    except Exception as e:
        log.error("MB discography fetch failed for %s: %s", artist_id, e)

    return sorted(albums, key=lambda x: x.get("first_release_date", ""))


def _normalize(name: str) -> str:
    import re
    name = name.lower().strip()
    name = re.sub(r"\s*\(.*?\)\s*", "", name)  # Remove parenthetical
    name = re.sub(r"\s*\[.*?\]\s*", "", name)  # Remove brackets
    name = re.sub(r"[^a-z0-9\s]", "", name)    # Remove non-alphanumeric
    name = re.sub(r"\s+", " ", name).strip()
    return name


def _is_similar(a: str, b: str) -> bool:
    """Quick similarity check without importing thefuzz for speed."""
    if a == b:
        return True
    if not a or not b:
        return False
    # Check if one contains the other
    if a in b or b in a:
        return True
    # Simple Jaccard on words
    words_a = set(a.split())
    words_b = set(b.split())
    if not words_a or not words_b:
        return False
    intersection = words_a & words_b
    union = words_a | words_b
    return len(intersection) / len(union) > 0.6
