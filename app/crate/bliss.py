"""Integration with crate-cli Rust binary for bliss song distance/similarity."""

import json
import logging
import random
import re
from crate.crate_cli import find_binary, is_available, run_bliss
from crate.db.queries.bliss import (
    build_user_radio_profile,
    get_album_tracks_for_radio,
    get_artist_by_id,
    get_artist_genre_ids as _db_get_artist_genre_ids,
    get_artist_genre_map as _db_get_artist_genre_map,
    get_artist_tracks,
    get_bliss_candidates,
    get_multi_seed_bliss_candidates,
    get_playlist_tracks_for_radio,
    get_recommend_without_bliss_candidates,
    get_same_artist_tracks,
    get_seed_tracks_by_paths,
    get_similar_artist_rows as _db_get_similar_artist_rows,
    get_similar_artist_tracks_for_radio,
    get_track_with_artist,
    store_bliss_vectors,
)

log = logging.getLogger(__name__)

# Camelot wheel mapping: (key, scale) -> camelot position
CAMELOT = {
    ("C", "major"): "8B",  ("A", "minor"): "8A",
    ("G", "major"): "9B",  ("E", "minor"): "9A",
    ("D", "major"): "10B", ("B", "minor"): "10A",
    ("A", "major"): "11B", ("F#", "minor"): "11A",
    ("E", "major"): "12B", ("C#", "minor"): "12A",
    ("B", "major"): "1B",  ("G#", "minor"): "1A",
    ("F#", "major"): "2B", ("D#", "minor"): "2A",
    ("C#", "major"): "3B", ("A#", "minor"): "3A",
    ("G#", "major"): "4B", ("F", "minor"): "4A",
    ("D#", "major"): "5B", ("C", "minor"): "5A",
    ("A#", "major"): "6B", ("G", "minor"): "6A",
    ("F", "major"): "7B",  ("D", "minor"): "7A",
}

_LOW_SIGNAL_TITLE_RE = re.compile(
    r"\b("
    r"intro|interlude|outro|reprise|skit|spoken word|voice memo|voicemail|"
    r"announcement|radio edit|commentary|bonus track|demo|rough mix|"
    r"instrumental|karaoke|acapella|a cappella"
    r")\b",
    re.IGNORECASE,
)
_ALT_VERSION_RE = re.compile(
    r"\b("
    r"live|remaster(?:ed)?|redux|re-recorded|acoustic|orchestral|"
    r"alternate take|alt take|session|demo|version|mix|edit"
    r")\b",
    re.IGNORECASE,
)
_TITLE_STRIP_RE = re.compile(r"\s*[\(\[].*?[\)\]]\s*")


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = sum(x * x for x in a) ** 0.5
    mag_b = sum(x * x for x in b) ** 0.5
    return max(0.0, dot / (mag_a * mag_b)) if mag_a and mag_b else 0.0


def _key_compatibility(key_a: str | None, scale_a: str | None,
                       key_b: str | None, scale_b: str | None) -> float:
    """Return 1.0 for same key, 0.8 for adjacent on Camelot wheel, 0.3 otherwise."""
    if not key_a or not scale_a or not key_b or not scale_b:
        return 0.5  # neutral when data missing
    pos_a = CAMELOT.get((key_a, scale_a))
    pos_b = CAMELOT.get((key_b, scale_b))
    if not pos_a or not pos_b:
        return 0.5
    if pos_a == pos_b:
        return 1.0
    # Adjacent: same number different letter, or +/-1 number same letter
    num_a, letter_a = int(pos_a[:-1]), pos_a[-1]
    num_b, letter_b = int(pos_b[:-1]), pos_b[-1]
    if letter_a == letter_b and abs(num_a - num_b) in (1, 11):
        return 0.8
    if num_a == num_b and letter_a != letter_b:
        return 0.8
    return 0.3


def _genre_jaccard(genres_a: set[str], genres_b: set[str]) -> float:
    if not genres_a or not genres_b:
        return 0.0
    intersection = len(genres_a & genres_b)
    union = len(genres_a | genres_b)
    return intersection / union if union else 0.0


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def _normalize_similarity_score(score: float | int | str | None) -> float:
    try:
        value = float(score or 0.0)
    except (TypeError, ValueError):
        return 0.0
    if value <= 0.0:
        return 0.0
    if value <= 1.0:
        return value
    if value <= 100.0:
        return value / 100.0
    return 1.0


def _candidate_artist_name(track: dict) -> str:
    artist = track.get("album_artist") or track.get("_artist_lookup_name") or track.get("artist") or ""
    return artist.strip() if isinstance(artist, str) else ""


def _normalized_title_key(track: dict) -> str:
    title = (track.get("title") or "").strip().lower()
    if not title:
        return ""
    title = _TITLE_STRIP_RE.sub(" ", title)
    title = re.sub(r"\s+", " ", title).strip()
    return title


def _year_bucket(track: dict) -> int | None:
    raw_year = track.get("year")
    try:
        year = int(raw_year)
    except (TypeError, ValueError):
        return None
    if year <= 0:
        return None
    return (year // 10) * 10


def _track_curation_penalty(track: dict) -> float:
    title = (track.get("title") or "").strip()
    album = (track.get("album") or "").strip()
    title_and_album = f"{title} {album}".strip()
    penalty = 0.0

    if title and _LOW_SIGNAL_TITLE_RE.search(title):
        penalty += 0.12
    if title_and_album and _ALT_VERSION_RE.search(title_and_album):
        penalty += 0.08

    duration = track.get("duration")
    try:
        duration_value = float(duration or 0.0)
    except (TypeError, ValueError):
        duration_value = 0.0
    if 0 < duration_value < 45:
        penalty += 0.06
    elif 0 < duration_value < 75:
        penalty += 0.03

    return min(0.3, penalty)


def _year_proximity(seed: dict, candidate: dict) -> float:
    seed_year = seed.get("year")
    cand_year = candidate.get("year")
    try:
        if seed_year is None or cand_year is None:
            return 0.5
        diff = abs(int(seed_year) - int(cand_year))
    except (TypeError, ValueError):
        return 0.5
    return max(0.0, 1.0 - diff / 25.0)


def _score_candidate(candidate: dict, seeds: list[dict],
                     artist_genres: set[str], similar_artist_names: set[str]) -> float:
    """Score a candidate track against a list of seed tracks, return best score."""
    best = 0.0
    cand_genres = set(candidate.get("_genres") or [])
    cand_artist = _candidate_artist_name(candidate)
    similar_artist_lookup = {name.lower() for name in similar_artist_names if isinstance(name, str)}

    for seed in seeds:
        score = 0.0

        # Bliss cosine similarity (weight 0.3)
        if candidate.get("bliss_vector") and seed.get("bliss_vector"):
            score += 0.3 * _cosine_similarity(candidate["bliss_vector"], seed["bliss_vector"])

        # BPM proximity (weight 0.15)
        if candidate.get("bpm") and seed.get("bpm"):
            diff = abs(candidate["bpm"] - seed["bpm"])
            score += 0.15 * max(0.0, 1.0 - diff / 40.0)

        # Key compatibility via Camelot (weight 0.1)
        score += 0.1 * _key_compatibility(
            seed.get("audio_key"), seed.get("audio_scale"),
            candidate.get("audio_key"), candidate.get("audio_scale"),
        )

        # Energy proximity (weight 0.1)
        if candidate.get("energy") is not None and seed.get("energy") is not None:
            score += 0.1 * (1.0 - abs(candidate["energy"] - seed["energy"]))

        # Era proximity (weight 0.05)
        score += 0.05 * _year_proximity(seed, candidate)

        # Genre Jaccard overlap (weight 0.15)
        seed_genres = set(seed.get("_genres") or [])
        score += 0.15 * _genre_jaccard(artist_genres | seed_genres, cand_genres)

        # Similar artist bonus (weight 0.2)
        artist_similarity_score = candidate.get("_artist_similarity_score")
        if artist_similarity_score is not None:
            score += 0.2 * _clamp01(float(artist_similarity_score))
        elif cand_artist and cand_artist.lower() in similar_artist_lookup:
            score += 0.2

        score -= _track_curation_penalty(candidate)

        if score > best:
            best = score

    return max(0.0, best)


def _get_similar_artist_rows(
    *,
    artist_id: int | None = None,
    artist_name: str | None = None,
) -> list[dict]:
    return _db_get_similar_artist_rows(artist_id=artist_id, artist_name=artist_name)


def _get_similar_artist_names(
    artist_name: str | None = None,
    *,
    artist_id: int | None = None,
    in_library_only: bool = False,
) -> set[str]:
    rows = _get_similar_artist_rows(artist_id=artist_id, artist_name=artist_name)
    if in_library_only:
        rows = [row for row in rows if row.get("in_library")]
    return {row["similar_name"] for row in rows if row.get("similar_name")}


def _get_similar_artist_score_map(rows: list[dict]) -> dict[str, float]:
    return {
        row["similar_name"].lower(): _normalize_similarity_score(row.get("score"))
        for row in rows
        if row.get("similar_name")
    }


def _get_artist_genre_ids(artist_name: str) -> set[str]:
    return _db_get_artist_genre_ids(artist_name=artist_name)


def _get_artist_genre_map(artist_names: set[str]) -> dict[str, set[str]]:
    return _db_get_artist_genre_map(artist_names=artist_names)


def _select_seed_tracks(tracks: list[dict], *, max_count: int, require_bliss: bool = True) -> list[dict]:
    if max_count <= 0 or not tracks:
        return []

    pool = [track for track in tracks if track.get("bliss_vector")] if require_bliss else list(tracks)
    if not pool and require_bliss:
        pool = list(tracks)
    if not pool:
        return []

    shuffled = list(pool)
    random.shuffle(shuffled)

    selected: list[dict] = []
    seen_paths: set[str] = set()
    seen_albums: set[str] = set()
    seen_eras: set[int] = set()

    for track in shuffled:
        album_key = (track.get("album") or "").strip().lower()
        era_bucket = _year_bucket(track)
        track_path = track.get("path") or track.get("track_path")
        if not track_path:
            continue
        if era_bucket is None or era_bucket in seen_eras or (album_key and album_key in seen_albums):
            continue
        selected.append(track)
        seen_paths.add(track_path)
        seen_eras.add(era_bucket)
        if album_key:
            seen_albums.add(album_key)
        if len(selected) >= max_count:
            return selected

    for track in shuffled:
        album_key = (track.get("album") or "").strip().lower()
        track_path = track.get("path") or track.get("track_path")
        if not track_path or track_path in seen_paths:
            continue
        if album_key and album_key in seen_albums:
            continue
        selected.append(track)
        if album_key:
            seen_albums.add(album_key)
        if track_path:
            seen_paths.add(track_path)
        if len(selected) >= max_count:
            return selected

    for track in shuffled:
        track_path = track.get("path") or track.get("track_path")
        if track_path and track_path in seen_paths:
            continue
        selected.append(track)
        if track_path:
            seen_paths.add(track_path)
        if len(selected) >= max_count:
            break

    return selected


def _can_place_track(
    playlist: list[dict],
    candidate: dict,
    *,
    max_consecutive_artist: int = 2,
    album_cooldown: int = 2,
    title_cooldown: int = 5,
) -> bool:
    candidate_artist = _candidate_artist_name(candidate).lower()
    if candidate_artist and max_consecutive_artist > 0:
        recent_tracks = playlist[-max_consecutive_artist:]
        if len(recent_tracks) == max_consecutive_artist and all(
            _candidate_artist_name(track).lower() == candidate_artist
            for track in recent_tracks
        ):
            return False

    candidate_album = (candidate.get("album") or "").strip().lower()
    if candidate_artist and candidate_album and album_cooldown > 0:
        recent_album_slice = playlist[-album_cooldown:]
        if any(
            _candidate_artist_name(track).lower() == candidate_artist
            and (track.get("album") or "").strip().lower() == candidate_album
            for track in recent_album_slice
        ):
            return False

    candidate_title = _normalized_title_key(candidate)
    if candidate_artist and candidate_title and title_cooldown > 0:
        recent_title_slice = playlist[-title_cooldown:]
        if any(
            _candidate_artist_name(track).lower() == candidate_artist
            and _normalized_title_key(track) == candidate_title
            for track in recent_title_slice
        ):
            return False

    return True


def _diversify_tracks(
    tracks: list[dict],
    *,
    max_consecutive_artist: int = 2,
    album_cooldown: int = 2,
    title_cooldown: int = 5,
) -> list[dict]:
    if len(tracks) < 3:
        return tracks

    pending = list(tracks)
    result: list[dict] = []
    forced = 0

    while pending:
        placed = False
        for index, track in enumerate(pending):
            if _can_place_track(
                result,
                track,
                max_consecutive_artist=max_consecutive_artist,
                album_cooldown=album_cooldown,
                title_cooldown=title_cooldown,
            ):
                result.append(track)
                pending.pop(index)
                placed = True
                forced = 0
                break
        if placed:
            continue

        result.append(pending.pop(0))
        forced += 1
        if forced > max(3, len(result)):
            result.extend(pending)
            break

    return result


def _apply_diversity(scored: list[tuple[float, dict]], max_consecutive: int = 2) -> list[dict]:
    """Sort by score and avoid artist/album clumps near the top of the queue."""
    ranked = [track for _, track in sorted(scored, key=lambda item: item[0], reverse=True)]
    return _diversify_tracks(
        ranked,
        max_consecutive_artist=max_consecutive,
        album_cooldown=2,
        title_cooldown=5,
    )


def analyze_file(filepath: str) -> list[float] | None:
    """Analyze a single file, return 20-float feature vector."""
    data = run_bliss(file=filepath)
    if not data:
        return None
    if data.get("error"):
        log.warning("bliss error for %s: %s", filepath, data["error"])
        return None
    return data.get("features")


def analyze_directory(dirpath: str, extensions: str = "flac,mp3,m4a,ogg,opus") -> dict:
    """Analyze all files in a directory. Returns {path: features} dict."""
    data = run_bliss(directory=dirpath, extensions=extensions)
    if not data:
        return {}
    out = {}
    for track in data.get("tracks", []):
        if not track.get("error") and track.get("features"):
            out[track["path"]] = track["features"]
    return out


def find_similar(source_path: str, library_path: str, limit: int = 20) -> list[dict]:
    """Find similar tracks to source within the library."""
    data = run_bliss(directory=library_path, similar_to=source_path, limit=limit)
    if not data:
        return []
    return data.get("similar", [])


def store_vectors(vectors: dict[str, list[float]]):
    """Store bliss feature vectors in the database (only for tracks missing them)."""
    store_bliss_vectors(vectors)


def _radio_track_payload(track: dict) -> dict:
    track_path = track.get("track_path") or track.get("path") or ""
    if track_path.startswith("/music/"):
        track_path = track_path[len("/music/") :]
    bliss_vector = track.get("bliss_vector")

    return {
        "track_id": track.get("track_id") or track.get("id"),
        "track_path": track_path,
        "title": track.get("title"),
        "artist": track.get("artist"),
        "album": track.get("album"),
        "duration": track.get("duration", 0),
        "score": track.get("score"),
        "bpm": track.get("bpm"),
        "audio_key": track.get("audio_key"),
        "audio_scale": track.get("audio_scale"),
        "energy": track.get("energy"),
        "danceability": track.get("danceability"),
        "valence": track.get("valence"),
        "bliss_vector": list(bliss_vector) if bliss_vector is not None else None,
    }


def _build_user_radio_profile(
    user_id: int | None,
    tracks: list[dict],
) -> dict:
    if not user_id or not tracks:
        return {}

    track_ids = [track["track_id"] for track in tracks if track.get("track_id") is not None]
    artist_names = sorted({
        _candidate_artist_name(track)
        for track in tracks
        if _candidate_artist_name(track)
    })
    artist_name_keys = [name.lower() for name in artist_names]
    album_pairs = sorted({
        (_candidate_artist_name(track), (track.get("album") or "").strip())
        for track in tracks
        if _candidate_artist_name(track) and (track.get("album") or "").strip()
    })

    return build_user_radio_profile(
        user_id,
        track_ids,
        artist_names,
        artist_name_keys,
        album_pairs,
    )


def _apply_user_profile_score(track: dict, score: float, user_profile: dict | None) -> float:
    if not user_profile:
        return score

    adjusted = score
    track_id = track.get("track_id")
    if track_id is not None and track_id in user_profile.get("liked_track_ids", set()):
        adjusted += 0.12

    rating = track.get("rating")
    try:
        rating_value = float(rating or 0.0)
    except (TypeError, ValueError):
        rating_value = 0.0
    if rating_value > 0:
        adjusted += 0.04 * min(rating_value, 5.0) / 5.0

    recent = user_profile.get("recent_track_events", {}).get(track_id)
    if recent:
        play_count = int(recent.get("play_count") or 0)
        skip_count = int(recent.get("skip_count") or 0)
        adjusted -= min(0.22, 0.06 * play_count)
        adjusted -= min(0.12, 0.05 * skip_count)

    artist_key = _candidate_artist_name(track).lower()
    artist_stats = user_profile.get("artist_stats", {}).get(artist_key)
    if artist_stats:
        artist_play_count = int(artist_stats.get("play_count") or 0)
        artist_complete = int(artist_stats.get("complete_play_count") or 0)
        if artist_play_count:
            completion_ratio = artist_complete / max(artist_play_count, 1)
            adjusted += min(0.08, completion_ratio * 0.05)
            adjusted -= min(0.08, artist_play_count / 250.0)

    album_key = (artist_key, (track.get("album") or "").strip().lower())
    album_stats = user_profile.get("album_stats", {}).get(album_key)
    if album_stats:
        album_play_count = int(album_stats.get("play_count") or 0)
        adjusted -= min(0.06, album_play_count / 120.0)

    return max(0.0, adjusted)


def _merge_ranked_tracks(*track_lists: list[dict], limit: int) -> list[dict]:
    merged: dict[str, dict] = {}

    for list_index, tracks in enumerate(track_lists):
        total = max(1, len(tracks))
        for rank, track in enumerate(tracks):
            key = track.get("track_path") or track.get("path") or (
                f"id:{track.get('track_id')}" if track.get("track_id") is not None else None
            )
            if not key:
                continue

            track_score = float(
                track.get("score")
                or track.get("_aggregate_score")
                or track.get("_blend_score")
                or 0.0
            )
            rank_bonus = max(0.0, (total - rank) / (total * 20))

            entry = merged.setdefault(
                key,
                {
                    **track,
                    "_blend_score": 0.0,
                    "_sources": 0,
                    "_best_rank": rank,
                },
            )
            entry["_blend_score"] += track_score + rank_bonus
            entry["_sources"] += 1
            entry["_best_rank"] = min(entry["_best_rank"], rank)

            if track_score > float(entry.get("score") or 0.0):
                entry["score"] = round(track_score, 4)

            for field in ("track_id", "title", "artist", "album", "duration"):
                if entry.get(field) is None and track.get(field) is not None:
                    entry[field] = track.get(field)

            if list_index == 0:
                entry.setdefault("_preferred_source", "bliss")

    ranked = sorted(
        merged.values(),
        key=lambda item: (item["_blend_score"], item["_sources"], -item["_best_rank"]),
        reverse=True,
    )
    return ranked[:limit]


def _recommend_without_bliss(
    seeds: list[dict],
    *,
    exclude_paths: list[str],
    limit: int,
    user_id: int | None = None,
    allow_seed_artists: bool = True,
) -> list[dict]:
    if not seeds:
        return []

    seed_paths = [path for path in exclude_paths if path]
    seed_artists = {_candidate_artist_name(seed) for seed in seeds if _candidate_artist_name(seed)}
    if not seed_artists:
        return []

    seed_genre_map = _get_artist_genre_map(seed_artists)
    similar_artist_map: dict[str, set[str]] = {}
    combined_score_map: dict[str, float] = {}
    for seed in seeds:
        seed_artist = _candidate_artist_name(seed)
        if not seed_artist:
            continue
        rows = _get_similar_artist_rows(
            artist_id=seed.get("artist_id"),
            artist_name=seed_artist,
        )
        in_library_rows = [row for row in rows if row.get("in_library")]
        similar_artist_map[seed_artist] = {
            row["similar_name"] for row in in_library_rows if row.get("similar_name")
        }
        for key, score in _get_similar_artist_score_map(in_library_rows).items():
            if score > combined_score_map.get(key, 0.0):
                combined_score_map[key] = score

    similar_artist_names = sorted({
        name.lower()
        for names in similar_artist_map.values()
        for name in names
        if isinstance(name, str) and name
    })

    candidates = get_recommend_without_bliss_candidates(
        seed_paths=seed_paths,
        similar_artist_names=similar_artist_names,
        artist_pick_limit=10 if similar_artist_names else 5,
        row_limit=max(limit * 8, 240),
    )
    candidate_artists = {_candidate_artist_name(row) for row in candidates if _candidate_artist_name(row)}
    candidate_genre_map = _get_artist_genre_map(candidate_artists)

    if not candidates:
        return []

    prepared_seeds = []
    for seed in seeds:
        seed_artist = _candidate_artist_name(seed)
        prepared_seeds.append({**seed, "_genres": list(seed_genre_map.get(seed_artist, set()))})

    user_profile = _build_user_radio_profile(user_id, prepared_seeds + candidates)
    seed_artist_keys = {artist.lower() for artist in seed_artists}
    scored: list[tuple[float, dict]] = []

    similar_artist_names_flat = {
        name
        for names in similar_artist_map.values()
        for name in names
    }

    for candidate in candidates:
        candidate_artist = _candidate_artist_name(candidate)
        candidate_artist_key = candidate_artist.lower()
        if not allow_seed_artists and candidate_artist_key in seed_artist_keys:
            continue

        candidate["_genres"] = list(candidate_genre_map.get(candidate_artist, set()))
        if candidate_artist_key in combined_score_map:
            candidate["_artist_similarity_score"] = combined_score_map[candidate_artist_key]
        score = _score_candidate(
            candidate,
            prepared_seeds,
            set().union(*(set(seed.get("_genres") or []) for seed in prepared_seeds)),
            similar_artist_names_flat,
        )
        score = _apply_user_profile_score(candidate, score, user_profile)
        scored.append(
            (
                score,
                {
                    **candidate,
                    **_radio_track_payload(candidate),
                    "score": round(score, 4),
                },
            )
        )

    return _apply_diversity(scored, max_consecutive=2)[:limit]


def _get_artist_radio_recommendations(
    artist_id: int,
    seeds: list[dict],
    artist_genres: set[str],
    similar_rows: list[dict],
    *,
    limit: int,
    user_id: int | None = None,
) -> list[dict]:
    if not seeds:
        return []

    seed_paths = [seed["path"] for seed in seeds if seed.get("path") and seed.get("bliss_vector")]
    if not seed_paths:
        seed_paths = [seed["path"] for seed in seeds if seed.get("path")]
    if not seed_paths:
        return []

    bliss_recommendations = _aggregate_similar_candidates(
        seed_paths,
        per_seed_limit=max(limit, 50),
        user_id=user_id,
    )

    in_library_similar = [row for row in similar_rows if row.get("in_library") and row.get("similar_name")]
    if not in_library_similar:
        return _diversify_tracks(bliss_recommendations)[:limit]

    seed_lookup = {
        seed["path"]: {**seed, "_genres": list(seed.get("_genres") or artist_genres)}
        for seed in seeds
        if seed.get("path")
    }
    similar_score_map = _get_similar_artist_score_map(in_library_similar)
    similar_artist_keys = [row["similar_name"].lower() for row in in_library_similar if row.get("similar_name")]

    candidate_rows = get_similar_artist_tracks_for_radio(
        similar_artist_keys=similar_artist_keys,
        limit=max(limit * 3, 60),
    )
    candidate_artists = {_candidate_artist_name(row) for row in candidate_rows if _candidate_artist_name(row)}
    artist_genre_map = _get_artist_genre_map(candidate_artists)

    if not candidate_rows:
        return _diversify_tracks(bliss_recommendations)[:limit]

    user_profile = _build_user_radio_profile(user_id, bliss_recommendations + candidate_rows)

    similar_artist_tracks: list[dict] = []
    for candidate in candidate_rows:
        lookup_artist = _candidate_artist_name(candidate)
        candidate["_genres"] = list(artist_genre_map.get(lookup_artist, set()))
        candidate["_artist_similarity_score"] = similar_score_map.get(lookup_artist.lower(), 0.0)
        score = _score_candidate(
            candidate,
            list(seed_lookup.values()),
            artist_genres,
            {row["similar_name"] for row in in_library_similar},
        )
        score = _apply_user_profile_score(candidate, score, user_profile)
        similar_artist_tracks.append(
            {
                **candidate,
                **_radio_track_payload(candidate),
                "score": round(score, 4),
            }
        )

    merged = _merge_ranked_tracks(
        bliss_recommendations,
        _apply_diversity([(float(track.get("score") or 0.0), track) for track in similar_artist_tracks]),
        limit=max(limit * 3, 60),
    )
    return _diversify_tracks(merged)[:limit]


def generate_artist_radio(
    artist_id: int,
    limit: int = 50,
    mix_ratio: float = 0.4,
    *,
    user_id: int | None = None,
) -> list[dict]:
    """Generate an Artist Radio playlist using stable artist IDs and multi-seed scoring."""
    artist_row = get_artist_by_id(artist_id=artist_id)
    if not artist_row:
        return []
    artist_name = artist_row["name"]

    all_artist_tracks = get_artist_tracks(artist_id=artist_id)
    if not all_artist_tracks:
        return []

    artist_genres = _get_artist_genre_ids(artist_name)
    similar_rows = _get_similar_artist_rows(artist_id=artist_id, artist_name=artist_name)

    seed_count = min(6, max(3, limit // 10 or 1))
    seeds = _select_seed_tracks(all_artist_tracks, max_count=seed_count, require_bliss=True)
    if not seeds:
        seeds = _select_seed_tracks(all_artist_tracks, max_count=seed_count, require_bliss=False)
    if not seeds:
        return []

    for seed in seeds:
        seed["_genres"] = list(artist_genres)

    recommended_tracks = _get_artist_radio_recommendations(
        artist_id,
        seeds,
        artist_genres,
        similar_rows,
        limit=max(limit * 3, 60),
        user_id=user_id,
    )

    source_tracks = [_radio_track_payload(track) for track in _select_seed_tracks(
        all_artist_tracks,
        max_count=max(limit, 24),
        require_bliss=False,
    )]

    # NOTE: recommended_tracks already have user-profile adjustments applied
    # inside _get_artist_radio_recommendations → _score_candidate pipeline.
    # Applying it again here would double every boost/penalty.

    return _interleave_radio_queue(
        source_tracks,
        recommended_tracks,
        limit=limit,
        source_mix_ratio=mix_ratio,
    )


def get_similar_from_db(track_path: str, limit: int = 20, *, user_id: int | None = None) -> list[dict]:
    """Find similar tracks using pre-computed vectors stored in DB (multi-signal scoring)."""
    source = get_track_with_artist(track_path=track_path)
    if not source:
        return []

    # Get source artist genres
    source_artist_name = _candidate_artist_name(source)
    source_genres = _get_artist_genre_ids(source_artist_name)
    source["_genres"] = list(source_genres)

    if not source.get("bliss_vector"):
        return _recommend_without_bliss(
            [source],
            exclude_paths=[track_path],
            limit=limit,
            user_id=user_id,
            allow_seed_artists=False,
        )

    # Get candidates via broad bliss distance (top 200), then re-rank in Python
    candidates = get_bliss_candidates(
        bliss_vector=source["bliss_vector"],
        exclude_path=track_path,
    )
    if not candidates:
        return []

    # Fetch genres for unique candidate artists
    candidate_artists = {_candidate_artist_name(c) for c in candidates if _candidate_artist_name(c)}
    artist_genre_map = _get_artist_genre_map(candidate_artists)

    # Get similar artist names for source artist
    similar_artist_names = _get_similar_artist_names(
        source_artist_name,
        artist_id=source.get("artist_id"),
        in_library_only=True,
    )

    # Attach genres and score
    for c in candidates:
        c["_genres"] = list(artist_genre_map.get(_candidate_artist_name(c), set()))

    user_profile = _build_user_radio_profile(user_id, [source] + candidates)

    scored = [
        (
            _apply_user_profile_score(
                c,
                _score_candidate(c, [source], source_genres, similar_artist_names),
                user_profile,
            ),
            c,
        )
        for c in candidates
    ]

    scored.sort(key=lambda x: x[0], reverse=True)

    result = []
    for score, t in scored[:limit]:
        result.append({
            **_radio_track_payload(t),
            "score": round(score, 4),
        })
    return result


def generate_track_radio(
    track_path: str,
    limit: int = 50,
    mix_ratio: float = 0.25,
    *,
    user_id: int | None = None,
) -> list[dict]:
    """Generate a Track Radio queue based on a source track."""
    seed = get_track_with_artist(track_path=track_path)
    if not seed:
        return []

    same_artist_tracks = get_same_artist_tracks(
        artist_id=seed.get("artist_id"),
        artist_name=_candidate_artist_name(seed),
        exclude_path=track_path,
        limit=max(limit, 24),
    )

    seed_payload = _radio_track_payload(seed)
    similar_tracks = get_similar_from_db(track_path, limit=max(limit * 3, 60), user_id=user_id)
    seen_paths = {seed_payload["track_path"]}
    unique_similar: list[dict] = []
    for track in similar_tracks:
        relative_path = track.get("track_path")
        if not relative_path or relative_path in seen_paths:
            continue
        seen_paths.add(relative_path)
        unique_similar.append(track)

    same_artist_count = max(1, int(limit * mix_ratio))
    picked_same_artist = _select_seed_tracks(
        same_artist_tracks,
        max_count=same_artist_count,
        require_bliss=False,
    )

    playlist = [seed_payload]
    playlist_paths = {playlist[0]["track_path"]}
    artist_index = 0
    similar_index = 0
    max_items = max(limit, 1)

    while len(playlist) < max_items:
        should_insert_artist = (
            artist_index < len(picked_same_artist)
            and (similar_index >= len(unique_similar) or len(playlist) % 4 == 0)
        )
        if should_insert_artist:
            candidate = _radio_track_payload(picked_same_artist[artist_index])
            artist_index += 1
        elif similar_index < len(unique_similar):
            candidate = unique_similar[similar_index]
            similar_index += 1
        else:
            break

        candidate_path = candidate.get("track_path")
        if not candidate_path or candidate_path in playlist_paths:
            continue

        playlist_paths.add(candidate_path)
        playlist.append(candidate)

    return _diversify_tracks(playlist)[:limit]


def _aggregate_similar_candidates(
    seed_paths: list[str],
    *,
    per_seed_limit: int = 40,
    user_id: int | None = None,
) -> list[dict]:
    if not seed_paths:
        return []

    seeds = get_seed_tracks_by_paths(seed_paths=seed_paths)
    if not seeds:
        return []

    bliss_seeds = [seed for seed in seeds if seed.get("bliss_vector")]
    if not bliss_seeds:
        return _recommend_without_bliss(
            seeds,
            exclude_paths=seed_paths,
            limit=max(per_seed_limit * 2, 80),
            user_id=user_id,
            allow_seed_artists=True,
        )

    candidate_rows = get_multi_seed_bliss_candidates(
        bliss_seed_paths=[seed["path"] for seed in bliss_seeds],
        all_seed_paths=seed_paths,
        per_seed_limit=per_seed_limit,
    )

    seed_artists = {_candidate_artist_name(seed) for seed in seeds if _candidate_artist_name(seed)}
    candidate_artists = {_candidate_artist_name(row) for row in candidate_rows if _candidate_artist_name(row)}
    seed_genre_map = _get_artist_genre_map(seed_artists)
    candidate_genre_map = _get_artist_genre_map(candidate_artists)
    similar_artist_map = {
        artist_name: _get_similar_artist_names(artist_name, in_library_only=True)
        for artist_name in seed_artists
    }

    if not candidate_rows:
        return []

    user_profile = _build_user_radio_profile(user_id, seeds + candidate_rows)

    seed_map = {
        seed["path"]: {**seed, "_genres": list(seed_genre_map.get(_candidate_artist_name(seed), set()))}
        for seed in seeds
    }

    aggregated: dict[str, dict] = {}
    for candidate_row in candidate_rows:
        seed = seed_map.get(candidate_row["seed_path"])
        if not seed:
            continue

        candidate = {
            key: value
            for key, value in candidate_row.items()
            if key not in {"seed_path", "seed_rank"}
        }
        candidate["_genres"] = list(candidate_genre_map.get(_candidate_artist_name(candidate), set()))

        score = _score_candidate(
            candidate,
            [seed],
            set(seed.get("_genres") or []),
            similar_artist_map.get(_candidate_artist_name(seed), set()),
        )
        score = _apply_user_profile_score(candidate, score, user_profile)

        track_path = candidate.get("path")
        if not track_path:
            continue

        entry = aggregated.setdefault(
            track_path,
            {
                **_radio_track_payload(candidate),
                "_aggregate_score": 0.0,
                "_hits": 0,
            },
        )
        rank = int(candidate_row.get("seed_rank") or per_seed_limit)
        entry["_aggregate_score"] += score + max(0.0, (per_seed_limit - rank) / (per_seed_limit * 100))
        entry["_hits"] += 1

    ranked = sorted(
        aggregated.values(),
        key=lambda item: (item["_aggregate_score"], item["_hits"]),
        reverse=True,
    )
    return ranked


def _interleave_radio_queue(
    source_tracks: list[dict],
    recommended_tracks: list[dict],
    *,
    limit: int,
    source_mix_ratio: float,
) -> list[dict]:
    source_count = max(1, int(limit * source_mix_ratio)) if source_tracks else 0
    picked_source = source_tracks[:source_count]

    playlist: list[dict] = []
    seen_paths: set[str] = set()
    source_index = 0
    recommended_index = 0

    while len(playlist) < limit:
        should_insert_source = (
            source_index < len(picked_source)
            and (recommended_index >= len(recommended_tracks) or len(playlist) % 4 == 0)
        )
        if should_insert_source:
            candidate = picked_source[source_index]
            if not candidate.get("track_path"):
                candidate = _radio_track_payload(candidate)
            source_index += 1
        elif recommended_index < len(recommended_tracks):
            candidate = recommended_tracks[recommended_index]
            recommended_index += 1
        else:
            break

        candidate_path = candidate.get("track_path") or candidate.get("path")
        if not candidate_path or candidate_path in seen_paths:
            continue

        seen_paths.add(candidate_path)
        playlist.append(candidate)

    return _diversify_tracks(playlist)[:limit]


def generate_album_radio(
    album_id: int,
    limit: int = 50,
    source_mix_ratio: float = 0.25,
    *,
    user_id: int | None = None,
) -> list[dict]:
    album_tracks = get_album_tracks_for_radio(album_id=album_id)

    if not album_tracks:
        return []

    source_tracks = [_radio_track_payload(track) for track in album_tracks]
    seed_tracks = _select_seed_tracks(album_tracks, max_count=min(4, len(album_tracks)), require_bliss=True)
    if not seed_tracks:
        seed_tracks = _select_seed_tracks(album_tracks, max_count=min(4, len(album_tracks)), require_bliss=False)
    seed_paths = [track["path"] for track in seed_tracks if track.get("path")]
    recommended_tracks = _aggregate_similar_candidates(
        seed_paths,
        per_seed_limit=max(limit, 40),
        user_id=user_id,
    )

    # NOTE: _aggregate_similar_candidates already applies the user profile
    # internally; reapplying here would double every boost/penalty.

    return _interleave_radio_queue(
        source_tracks,
        recommended_tracks,
        limit=limit,
        source_mix_ratio=source_mix_ratio,
    )


def generate_playlist_radio(
    playlist_id: int,
    limit: int = 50,
    source_mix_ratio: float = 0.3,
    *,
    user_id: int | None = None,
) -> list[dict]:
    playlist_tracks = get_playlist_tracks_for_radio(playlist_id=playlist_id)

    source_tracks = [_radio_track_payload(track) for track in playlist_tracks if track.get("path")]
    if not source_tracks:
        return []

    seed_tracks = _select_seed_tracks(playlist_tracks, max_count=min(5, len(playlist_tracks)), require_bliss=True)
    if not seed_tracks:
        seed_tracks = _select_seed_tracks(playlist_tracks, max_count=min(5, len(playlist_tracks)), require_bliss=False)
    seed_paths = [track["path"] for track in seed_tracks if track.get("path")]
    recommended_tracks = _aggregate_similar_candidates(
        seed_paths,
        per_seed_limit=max(limit, 40),
        user_id=user_id,
    )

    return _interleave_radio_queue(
        source_tracks,
        recommended_tracks,
        limit=limit,
        source_mix_ratio=source_mix_ratio,
    )


def generate_virtual_playlist_radio(
    playlist_tracks: list[dict],
    limit: int = 50,
    source_mix_ratio: float = 0.3,
    *,
    user_id: int | None = None,
) -> list[dict]:
    source_rows: list[dict] = []
    for track in playlist_tracks:
        current = dict(track)
        if current.get("track_path") and not current.get("path"):
            current["path"] = current["track_path"]
        source_rows.append(current)

    source_tracks = [_radio_track_payload(track) for track in source_rows if track.get("path")]
    if not source_tracks:
        return []

    seed_tracks = _select_seed_tracks(source_rows, max_count=min(5, len(source_rows)), require_bliss=True)
    if not seed_tracks:
        seed_tracks = _select_seed_tracks(source_rows, max_count=min(5, len(source_rows)), require_bliss=False)
    seed_paths = [
        track.get("path") or track.get("track_path")
        for track in seed_tracks
        if track.get("path") or track.get("track_path")
    ]
    recommended_tracks = _aggregate_similar_candidates(
        seed_paths,
        per_seed_limit=max(limit, 40),
        user_id=user_id,
    )

    return _interleave_radio_queue(
        source_tracks,
        recommended_tracks,
        limit=limit,
        source_mix_ratio=source_mix_ratio,
    )
