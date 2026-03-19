"""MusicBrainz matching via beets autotagger as backend."""

import logging
from pathlib import Path

import musicbrainzngs
import mutagen

from librarian.audio import get_audio_files, read_tags

log = logging.getLogger(__name__)

musicbrainzngs.set_useragent("musicdock-librarian", "0.1", "https://github.com/musicdock")


def match_album(album_dir: Path, extensions: set[str]) -> list[dict]:
    """Find MusicBrainz release candidates for a local album.

    Uses track titles, durations, and album/artist names to find matches.
    Returns ranked list of candidates with match details.
    """
    tracks = get_audio_files(album_dir, extensions)
    if not tracks:
        return []

    # Gather local info
    local_info = _gather_local_info(tracks)
    artist = local_info["artist"]
    album = local_info["album"]

    if not artist and not album:
        # Fallback to directory names
        artist = album_dir.parent.name
        album = album_dir.name

    # Search MusicBrainz
    candidates = _search_musicbrainz(artist, album, len(tracks))

    # Score each candidate against local tracks
    scored = []
    for candidate in candidates:
        release_detail = _get_release_detail(candidate["mbid"])
        if not release_detail:
            continue

        score = _score_match(local_info, release_detail)
        scored.append({
            **release_detail,
            "match_score": score,
            "tag_preview": _build_tag_preview(local_info, release_detail),
        })

    scored.sort(key=lambda x: x["match_score"], reverse=True)
    return scored[:5]


def apply_match(album_dir: Path, extensions: set[str], release: dict) -> dict:
    """Apply MusicBrainz tags from a matched release to local files."""
    tracks = get_audio_files(album_dir, extensions)
    mb_tracks = release.get("tracks", [])

    updated = 0
    errors = []

    for i, track_path in enumerate(tracks):
        if i >= len(mb_tracks):
            break

        mb = mb_tracks[i]
        try:
            audio = mutagen.File(track_path, easy=True)
            if audio is None:
                continue

            audio["title"] = mb["title"]
            audio["tracknumber"] = f"{mb.get('number', i + 1)}/{len(mb_tracks)}"
            audio["discnumber"] = str(mb.get("disc", 1))
            audio["album"] = release.get("title", "")
            audio["albumartist"] = release.get("artist", "")
            audio["date"] = release.get("date", "")

            if mb.get("mbid"):
                audio["musicbrainz_trackid"] = mb["mbid"]
            if release.get("mbid"):
                audio["musicbrainz_albumid"] = release["mbid"]
            if release.get("release_group_id"):
                audio["musicbrainz_releasegroupid"] = release["release_group_id"]

            audio.save()
            updated += 1
        except Exception as e:
            errors.append({"file": track_path.name, "error": str(e)})

    return {"updated": updated, "total": len(tracks), "errors": errors}


def _gather_local_info(tracks: list[Path]) -> dict:
    """Read tags from local tracks to build search query."""
    artists = []
    albums = []
    track_info = []

    for t in tracks:
        tags = read_tags(t)
        info = mutagen.File(t)
        length = getattr(info.info, "length", 0) if info else 0

        artists.append(tags.get("albumartist") or tags.get("artist", ""))
        albums.append(tags.get("album", ""))
        track_info.append({
            "filename": t.name,
            "title": tags.get("title", t.stem),
            "tracknumber": tags.get("tracknumber", ""),
            "length_sec": round(length),
        })

    # Most common artist/album
    artist = max(set(artists), key=artists.count) if artists else ""
    album = max(set(albums), key=albums.count) if albums else ""

    return {
        "artist": artist,
        "album": album,
        "track_count": len(tracks),
        "tracks": track_info,
        "total_length": sum(t["length_sec"] for t in track_info),
    }


def _search_musicbrainz(artist: str, album: str, track_count: int) -> list[dict]:
    """Search MB for release candidates."""
    try:
        results = musicbrainzngs.search_releases(
            artist=artist, release=album, tracks=track_count, limit=10
        )
        candidates = []
        for r in results.get("release-list", []):
            candidates.append({
                "mbid": r.get("id"),
                "title": r.get("title"),
                "artist": r.get("artist-credit-phrase", ""),
                "date": r.get("date", ""),
                "score": int(r.get("ext:score", 0)),
            })
        return candidates
    except Exception as e:
        log.error("MB search failed: %s", e)
        return []


def _get_release_detail(mbid: str) -> dict | None:
    """Get full release with track listing from MB."""
    try:
        result = musicbrainzngs.get_release_by_id(
            mbid, includes=["recordings", "release-groups", "artist-credits"]
        )
        release = result.get("release", {})
        media = release.get("medium-list", [])

        tracks = []
        for medium in media:
            disc = int(medium.get("position", 1))
            for t in medium.get("track-list", []):
                rec = t.get("recording", {})
                length = int(rec.get("length", 0)) // 1000 if rec.get("length") else 0
                tracks.append({
                    "disc": disc,
                    "number": t.get("number", ""),
                    "title": rec.get("title", ""),
                    "length_sec": length,
                    "mbid": rec.get("id"),
                })

        return {
            "mbid": mbid,
            "title": release.get("title"),
            "artist": release.get("artist-credit-phrase", ""),
            "date": release.get("date", ""),
            "country": release.get("country", ""),
            "track_count": len(tracks),
            "release_group_id": release.get("release-group", {}).get("id"),
            "tracks": tracks,
        }
    except Exception as e:
        log.error("MB release lookup failed for %s: %s", mbid, e)
        return None


def _score_match(local: dict, release: dict) -> int:
    """Score how well a MB release matches local files. 0-100."""
    score = 0

    # Track count match (0-30)
    local_count = local["track_count"]
    mb_count = release["track_count"]
    if local_count == mb_count:
        score += 30
    elif abs(local_count - mb_count) <= 2:
        score += 15

    # Duration match (0-30)
    local_tracks = local["tracks"]
    mb_tracks = release["tracks"]
    duration_diffs = []
    for i, lt in enumerate(local_tracks):
        if i >= len(mb_tracks):
            break
        diff = abs(lt["length_sec"] - mb_tracks[i]["length_sec"])
        duration_diffs.append(diff)

    if duration_diffs:
        avg_diff = sum(duration_diffs) / len(duration_diffs)
        if avg_diff <= 2:
            score += 30
        elif avg_diff <= 5:
            score += 20
        elif avg_diff <= 10:
            score += 10

    # Title similarity (0-25)
    from thefuzz import fuzz
    title_scores = []
    for i, lt in enumerate(local_tracks):
        if i >= len(mb_tracks):
            break
        ratio = fuzz.ratio(lt["title"].lower(), mb_tracks[i]["title"].lower())
        title_scores.append(ratio)

    if title_scores:
        avg_title = sum(title_scores) / len(title_scores)
        score += int(avg_title * 0.25)

    # Album name match (0-15)
    if local["album"]:
        album_ratio = fuzz.ratio(local["album"].lower(), release["title"].lower())
        score += int(album_ratio * 0.15)

    return min(score, 100)


def _build_tag_preview(local: dict, release: dict) -> list[dict]:
    """Build a side-by-side preview of current vs proposed tags."""
    preview = []
    local_tracks = local["tracks"]
    mb_tracks = release["tracks"]

    for i, lt in enumerate(local_tracks):
        mb = mb_tracks[i] if i < len(mb_tracks) else {}
        preview.append({
            "filename": lt["filename"],
            "current_title": lt["title"],
            "new_title": mb.get("title", ""),
            "current_track": lt["tracknumber"],
            "new_track": mb.get("number", ""),
            "duration_diff": abs(lt["length_sec"] - mb.get("length_sec", 0)) if mb else None,
        })

    return preview
