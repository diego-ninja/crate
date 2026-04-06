"""MusicBrainz matching via beets autotagger as backend."""

import logging
from pathlib import Path

import musicbrainzngs
import mutagen

from crate.audio import get_audio_files, read_tags

log = logging.getLogger(__name__)



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
    """Apply MusicBrainz tags from a matched release to local files.

    Pairs local tracks to MB tracks by tracknumber tag (not filename order).
    """
    from thefuzz import fuzz

    tracks = get_audio_files(album_dir, extensions)
    mb_tracks = release.get("tracks", [])

    # Build ordered local tracks by reading tracknumber tag
    local_with_path = []
    for t in tracks:
        tags = read_tags(t)
        tn_raw = tags.get("tracknumber", "")
        try:
            tn = int(str(tn_raw).split("/")[0])
        except (ValueError, TypeError):
            tn = 9999
        local_with_path.append({
            "path": t,
            "tracknumber": tn,
            "title": tags.get("title", t.stem),
        })
    local_with_path.sort(key=lambda x: (x["tracknumber"], x["path"].name))

    updated = 0
    errors = []

    for local_track in local_with_path:
        # Find best MB track match by title similarity
        best_score = 0
        best_mb = None
        for mb in mb_tracks:
            ratio = fuzz.ratio(local_track["title"].lower(), mb["title"].lower())
            if ratio > best_score:
                best_score = ratio
                best_mb = mb

        if not best_mb or best_score < 50:
            continue

        try:
            audio = mutagen.File(local_track["path"], easy=True)
            if audio is None:
                continue

            audio["title"] = best_mb["title"]
            audio["tracknumber"] = f"{best_mb.get('number', 1)}/{len(mb_tracks)}"
            audio["discnumber"] = str(best_mb.get("disc", 1))
            audio["album"] = release.get("title", "")
            audio["albumartist"] = release.get("artist", "")
            audio["date"] = release.get("date", "")

            if best_mb.get("mbid"):
                audio["musicbrainz_trackid"] = best_mb["mbid"]
            if release.get("mbid"):
                audio["musicbrainz_albumid"] = release["mbid"]
            if release.get("release_group_id"):
                audio["musicbrainz_releasegroupid"] = release["release_group_id"]

            audio.save()
            updated += 1
        except Exception as e:
            errors.append({"file": local_track["path"].name, "error": str(e)})

    return {
        "updated": updated,
        "total": len(tracks),
        "errors": errors,
        "mbid": release.get("mbid"),
        "release_group_id": release.get("release_group_id"),
    }


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

    # Sort by track number tag (fall back to filename order)
    def _track_sort_key(t: dict) -> tuple[int, str]:
        tn = t["tracknumber"]
        try:
            return (int(tn.split("/")[0]), t["filename"])
        except (ValueError, AttributeError, IndexError):
            return (9999, t["filename"])

    track_info.sort(key=_track_sort_key)

    return {
        "artist": artist,
        "album": album,
        "track_count": len(tracks),
        "tracks": track_info,
        "total_length": sum(t["length_sec"] for t in track_info),
    }


def _search_musicbrainz(artist: str, album: str, track_count: int) -> list[dict]:
    """Search MB for release candidates.

    Runs two queries: one with track count filter and one without,
    to avoid missing valid releases with bonus tracks or different editions.
    """
    seen_mbids: set[str] = set()
    candidates: list[dict] = []

    queries = [
        {"artist": artist, "release": album, "limit": 10},
        {"artist": artist, "release": album, "tracks": track_count, "limit": 10},
    ]

    for kwargs in queries:
        try:
            results = musicbrainzngs.search_releases(**kwargs)
            for r in results.get("release-list", []):
                mbid = r.get("id")
                if mbid in seen_mbids:
                    continue
                seen_mbids.add(mbid)
                candidates.append({
                    "mbid": mbid,
                    "title": r.get("title"),
                    "artist": r.get("artist-credit-phrase", ""),
                    "date": r.get("date", ""),
                    "score": int(r.get("ext:score", 0)),
                })
        except Exception as e:
            log.error("MB search failed: %s", e)

    return candidates


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


def _best_title_match(title: str, candidates: list[dict]) -> tuple[int, dict | None]:
    """Find the best matching MB track for a local title. Returns (score, track)."""
    from thefuzz import fuzz
    best_score = 0
    best_track = None
    title_lower = title.lower()
    for c in candidates:
        ratio = fuzz.ratio(title_lower, c["title"].lower())
        if ratio > best_score:
            best_score = ratio
            best_track = c
    return best_score, best_track


def _score_match(local: dict, release: dict) -> int:
    """Score how well a MB release matches local files. 0-100.

    Uses best-match pairing (not positional) so bonus tracks or
    different track order don't tank the score.  Deluxe/expanded
    editions are handled gracefully: only matched tracks count toward
    the title-similarity average, and track-count differences are
    scored relative to the smaller side.
    """
    from thefuzz import fuzz

    score = 0
    local_count = local["track_count"]
    mb_count = release["track_count"]
    local_tracks = local["tracks"]
    mb_tracks = release["tracks"]

    # Track count match (0-15)
    # Use ratio so deluxe editions (24 vs 14) still score something
    if local_count and mb_count:
        count_ratio = min(local_count, mb_count) / max(local_count, mb_count)
        score += int(count_ratio * 15)

    # Best-match title + duration pairing (0-50)
    matched_title_scores = []
    unmatched_count = 0
    duration_diffs = []
    remaining_mb = list(mb_tracks)

    for lt in local_tracks:
        t_score, best = _best_title_match(lt["title"], remaining_mb)
        if best and t_score >= 50:
            matched_title_scores.append(t_score)
            duration_diffs.append(abs(lt["length_sec"] - best.get("length_sec", 0)))
            remaining_mb.remove(best)
        else:
            unmatched_count += 1

    # Coverage: what fraction of MB tracks did we match?
    matched_count = len(matched_title_scores)
    coverage = matched_count / mb_count if mb_count else 0

    if matched_title_scores:
        avg_title = sum(matched_title_scores) / len(matched_title_scores)
        # Scale by coverage so a partial match (deluxe) still scores well
        score += int(avg_title * 0.35 * max(coverage, 0.6))  # 0-35

    if duration_diffs:
        avg_diff = sum(duration_diffs) / len(duration_diffs)
        if avg_diff <= 2:
            score += 15
        elif avg_diff <= 5:
            score += 10
        elif avg_diff <= 10:
            score += 5

    # Album name match (0-25)
    # Use token_set_ratio so "Album (Deluxe Edition)" matches "Album"
    if local["album"]:
        album_ratio = fuzz.token_set_ratio(local["album"].lower(), release["title"].lower())
        score += int(album_ratio * 0.25)

    # Artist name match (0-10)
    if local["artist"] and release.get("artist"):
        artist_ratio = fuzz.token_set_ratio(local["artist"].lower(), release["artist"].lower())
        score += int(artist_ratio * 0.10)

    return min(score, 100)


def _build_tag_preview(local: dict, release: dict) -> list[dict]:
    """Build a side-by-side preview using best-match pairing (not positional)."""
    from thefuzz import fuzz
    preview = []
    local_tracks = local["tracks"]
    mb_tracks = list(release["tracks"])
    remaining = list(mb_tracks)

    for lt in local_tracks:
        best_score = 0
        best_mb: dict = {}
        for mb in remaining:
            ratio = fuzz.ratio(lt["title"].lower(), mb["title"].lower())
            if ratio > best_score:
                best_score = ratio
                best_mb = mb
        if best_mb and best_score >= 50:
            remaining.remove(best_mb)
        else:
            best_mb = {}
        preview.append({
            "filename": lt["filename"],
            "current_title": lt["title"],
            "new_title": best_mb.get("title", ""),
            "current_track": lt["tracknumber"],
            "new_track": best_mb.get("number", ""),
            "duration_diff": abs(lt["length_sec"] - best_mb.get("length_sec", 0)) if best_mb else None,
        })

    return preview
