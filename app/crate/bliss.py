"""Integration with crate-cli Rust binary for bliss song distance/similarity."""

import json
import logging
import random

from crate.crate_cli import find_binary, is_available, run_bliss
from crate.db import get_db_ctx

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


def _score_candidate(candidate: dict, seeds: list[dict],
                     artist_genres: set[str], similar_artist_names: set[str]) -> float:
    """Score a candidate track against a list of seed tracks, return best score."""
    best = 0.0
    cand_genres = set(candidate.get("_genres") or [])

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

        # Genre Jaccard overlap (weight 0.15)
        seed_genres = set(seed.get("_genres") or [])
        score += 0.15 * _genre_jaccard(artist_genres | seed_genres, cand_genres)

        # Similar artist bonus (weight 0.2)
        if candidate.get("artist") in similar_artist_names:
            score += 0.2

        if score > best:
            best = score

    return best


def _get_similar_artist_names(cur, artist_name: str) -> set[str]:
    """Return set of similar artist names using artist_similarities table or similar_json fallback."""
    # Try artist_similarities table first (Phase 1)
    try:
        cur.execute("""
            SELECT artist_b FROM artist_similarities
            WHERE artist_a = %s AND artist_b_in_library = TRUE
        """, (artist_name,))
        rows = cur.fetchall()
        if rows:
            return {r["artist_b"] for r in rows}
    except Exception:
        pass  # table may not exist yet

    # Fallback: parse similar_json from library_artists
    cur.execute("SELECT similar_json FROM library_artists WHERE name = %s", (artist_name,))
    row = cur.fetchone()
    if not row or not row["similar_json"]:
        return set()
    similar = row["similar_json"]
    if isinstance(similar, str):
        similar = json.loads(similar)
    if not isinstance(similar, list):
        return set()
    names = set()
    for item in similar:
        n = item.get("name") if isinstance(item, dict) else str(item)
        if n:
            names.add(n)
    return names


def _get_artist_genre_ids(cur, artist_name: str) -> set[str]:
    """Return genre names for an artist via artist_genres table."""
    cur.execute("""
        SELECT g.name FROM genres g
        JOIN artist_genres ag ON ag.genre_id = g.id
        WHERE ag.artist_name = %s
    """, (artist_name,))
    return {r["name"] for r in cur.fetchall()}


def _get_artist_genre_map(cur, artist_names: set[str]) -> dict[str, set[str]]:
    if not artist_names:
        return {}

    cur.execute(
        """
        SELECT ag.artist_name, g.name
        FROM artist_genres ag
        JOIN genres g ON ag.genre_id = g.id
        WHERE ag.artist_name = ANY(%s)
        """,
        (list(artist_names),),
    )
    genre_map: dict[str, set[str]] = {name: set() for name in artist_names}
    for row in cur.fetchall():
        genre_map.setdefault(row["artist_name"], set()).add(row["name"])
    return genre_map


def _apply_diversity(scored: list[tuple[float, dict]], max_consecutive: int = 3) -> list[dict]:
    """Sort by score and ensure no more than max_consecutive tracks from same artist."""
    scored.sort(key=lambda x: x[0], reverse=True)
    result = []
    consecutive: dict[str, int] = {}
    skipped = []

    for score, track in scored:
        artist = track.get("artist", "")
        count = consecutive.get(artist, 0)
        if count < max_consecutive:
            result.append(track)
            consecutive[artist] = count + 1
        else:
            skipped.append((score, track))

    # Append skipped tracks at end (still sorted by score)
    for _, track in skipped:
        result.append(track)

    return result


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
    with get_db_ctx() as cur:
        for path, features in vectors.items():
            cur.execute(
                "UPDATE library_tracks SET bliss_vector = %s WHERE path = %s AND bliss_vector IS NULL",
                (features, path),
            )


def _radio_track_payload(track: dict) -> dict:
    track_path = track.get("track_path") or track.get("path") or ""
    if track_path.startswith("/music/"):
        track_path = track_path[len("/music/") :]

    return {
        "track_id": track.get("track_id") or track.get("id"),
        "navidrome_id": track.get("navidrome_id"),
        "track_path": track_path,
        "title": track.get("title"),
        "artist": track.get("artist"),
        "album": track.get("album"),
        "duration": track.get("duration", 0),
        "score": track.get("score") if track.get("score") is not None else track.get("_score"),
    }


def generate_artist_radio(artist_name: str, limit: int = 50, mix_ratio: float = 0.4) -> list[dict]:
    """Generate an Artist Radio playlist using multi-signal scoring.

    mix_ratio: fraction of tracks from the artist (0.4 = 40% artist, 60% similar)
    """
    with get_db_ctx() as cur:
        # Fetch artist tracks (with or without bliss vectors)
        cur.execute("""
            SELECT t.id AS track_id, t.path, t.title, t.artist, a.name AS album, t.duration,
                   t.navidrome_id, t.bliss_vector, t.bpm, t.audio_key, t.audio_scale, t.energy
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE a.artist = %s
        """, (artist_name,))
        all_artist_tracks = [dict(r) for r in cur.fetchall()]

        if not all_artist_tracks:
            return []

        # Get artist genres
        artist_genres = _get_artist_genre_ids(cur, artist_name)

        # Get similar artist names
        similar_artist_names = _get_similar_artist_names(cur, artist_name)

        # Pick up to 5 random seed tracks that have bliss vectors
        tracks_with_bliss = [t for t in all_artist_tracks if t.get("bliss_vector")]
        if tracks_with_bliss:
            seeds = random.sample(tracks_with_bliss, min(5, len(tracks_with_bliss)))
        else:
            seeds = random.sample(all_artist_tracks, min(5, len(all_artist_tracks)))

        # Attach genres to seeds
        for seed in seeds:
            seed["_genres"] = list(artist_genres)

        # Build candidate set: tracks from similar artists + random sample, bliss_vector NOT NULL
        candidate_limit = 2000
        if similar_artist_names:
            cur.execute("""
                SELECT t.id AS track_id, t.path, t.title, t.artist, a.name AS album, t.duration,
                       t.navidrome_id, t.bliss_vector, t.bpm, t.audio_key, t.audio_scale, t.energy
                FROM library_tracks t
                JOIN library_albums a ON t.album_id = a.id
                WHERE t.bliss_vector IS NOT NULL
                  AND a.artist != %s
                  AND (a.artist = ANY(%s) OR t.id IN (
                      SELECT id FROM library_tracks
                      WHERE bliss_vector IS NOT NULL
                      ORDER BY RANDOM() LIMIT 500
                  ))
                LIMIT %s
            """, (artist_name, list(similar_artist_names), candidate_limit))
        else:
            cur.execute("""
                SELECT t.id AS track_id, t.path, t.title, t.artist, a.name AS album, t.duration,
                       t.navidrome_id, t.bliss_vector, t.bpm, t.audio_key, t.audio_scale, t.energy
                FROM library_tracks t
                JOIN library_albums a ON t.album_id = a.id
                WHERE t.bliss_vector IS NOT NULL AND a.artist != %s
                ORDER BY RANDOM()
                LIMIT %s
            """, (artist_name, candidate_limit))

        candidates = [dict(r) for r in cur.fetchall()]

        if not candidates:
            return []

        # Fetch genre names for each unique candidate artist
        candidate_artists = {c["artist"] for c in candidates}
        artist_genre_map = _get_artist_genre_map(cur, candidate_artists)

    # Attach genres to candidates
    for c in candidates:
        c["_genres"] = list(artist_genre_map.get(c["artist"], set()))

    # Score each candidate
    scored = [
        (_score_candidate(c, seeds, artist_genres, similar_artist_names), c)
        for c in candidates
    ]

    # Apply diversity (no more than 3 consecutive from same artist) and sort
    diverse = _apply_diversity(scored, max_consecutive=3)

    # Mix: artist tracks + external tracks
    artist_count = max(1, int(limit * mix_ratio))
    similar_count = limit - artist_count

    picked_artist = random.sample(all_artist_tracks, min(artist_count, len(all_artist_tracks)))
    picked_similar = diverse[:similar_count]

    # Interleave artist tracks into similar tracks organically
    playlist: list[dict] = []
    a_idx, s_idx = 0, 0
    for i in range(limit):
        if a_idx < len(picked_artist) and (s_idx >= len(picked_similar) or i % 3 == 0):
            t = picked_artist[a_idx]
            a_idx += 1
        elif s_idx < len(picked_similar):
            t = picked_similar[s_idx]
            s_idx += 1
        else:
            break
        playlist.append(_radio_track_payload(t))

    return playlist


def get_similar_from_db(track_path: str, limit: int = 20) -> list[dict]:
    """Find similar tracks using pre-computed vectors stored in DB (multi-signal scoring)."""
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT t.id AS track_id, t.path, t.title, t.artist, a.name AS album, t.duration,
                   t.navidrome_id, t.bliss_vector, t.bpm, t.audio_key, t.audio_scale, t.energy
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE t.path = %s
        """, (track_path,))
        row = cur.fetchone()
        if not row:
            return []

        source = dict(row)
        if not source.get("bliss_vector"):
            return []

        # Get source artist genres
        source_genres = _get_artist_genre_ids(cur, source["artist"])
        source["_genres"] = list(source_genres)

        # Get candidates via broad bliss distance (top 200), then re-rank in Python
        cur.execute("""
            SELECT t.id AS track_id, t.path, t.title, t.artist, a.name AS album, t.duration,
                   t.navidrome_id, t.bliss_vector, t.bpm, t.audio_key, t.audio_scale, t.energy,
                   SQRT(
                       (SELECT SUM(POW(x - y, 2))
                        FROM UNNEST(t.bliss_vector, %s::float8[]) AS v(x, y))
                   ) AS bliss_dist
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE t.bliss_vector IS NOT NULL AND t.path != %s
            ORDER BY bliss_dist ASC
            LIMIT 200
        """, (source["bliss_vector"], track_path))
        candidates = [dict(r) for r in cur.fetchall()]

        if not candidates:
            return []

        # Fetch genres for unique candidate artists
        candidate_artists = {c["artist"] for c in candidates}
        artist_genre_map = _get_artist_genre_map(cur, candidate_artists)

        # Get similar artist names for source artist
        similar_artist_names = _get_similar_artist_names(cur, source["artist"])

    # Attach genres and score
    for c in candidates:
        c["_genres"] = list(artist_genre_map.get(c["artist"], set()))

    scored = []
    for c in candidates:
        score = 0.0

        # Bliss cosine similarity (weight 0.3)
        score += 0.3 * _cosine_similarity(source["bliss_vector"], c["bliss_vector"])

        # BPM proximity (weight 0.15)
        if source.get("bpm") and c.get("bpm"):
            diff = abs(source["bpm"] - c["bpm"])
            score += 0.15 * max(0.0, 1.0 - diff / 40.0)

        # Key compatibility (weight 0.1)
        score += 0.1 * _key_compatibility(
            source.get("audio_key"), source.get("audio_scale"),
            c.get("audio_key"), c.get("audio_scale"),
        )

        # Energy proximity (weight 0.1)
        if source.get("energy") is not None and c.get("energy") is not None:
            score += 0.1 * (1.0 - abs(source["energy"] - c["energy"]))

        # Genre overlap (weight 0.15)
        score += 0.15 * _genre_jaccard(source_genres, set(c["_genres"]))

        # Similar artist bonus (weight 0.2)
        if c.get("artist") in similar_artist_names:
            score += 0.2

        scored.append((score, c))

    scored.sort(key=lambda x: x[0], reverse=True)

    result = []
    for score, t in scored[:limit]:
        result.append({
            **_radio_track_payload(t),
            "score": round(score, 4),
        })
    return result


def generate_track_radio(track_path: str, limit: int = 50, mix_ratio: float = 0.25) -> list[dict]:
    """Generate a Track Radio queue based on a source track."""
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT t.id AS track_id, t.path, t.title, t.artist, a.name AS album, t.duration,
                   t.navidrome_id, t.bliss_vector, t.bpm, t.audio_key, t.audio_scale, t.energy
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE t.path = %s
        """, (track_path,))
        row = cur.fetchone()
        if not row:
            return []

        seed = dict(row)
        cur.execute("""
            SELECT t.id AS track_id, t.path, t.title, t.artist, a.name AS album, t.duration, t.navidrome_id
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE a.artist = %s AND t.path != %s
            ORDER BY RANDOM()
            LIMIT %s
        """, (seed["artist"], track_path, max(limit, 24)))
        same_artist_tracks = [dict(r) for r in cur.fetchall()]

    seed_payload = _radio_track_payload(seed)
    similar_tracks = get_similar_from_db(track_path, limit=max(limit * 3, 60))
    seen_paths = {seed_payload["track_path"]}
    unique_similar: list[dict] = []
    for track in similar_tracks:
        relative_path = track.get("track_path")
        if not relative_path or relative_path in seen_paths:
            continue
        seen_paths.add(relative_path)
        unique_similar.append(track)

    same_artist_count = max(1, int(limit * mix_ratio))
    picked_same_artist = same_artist_tracks[:same_artist_count]

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

    return playlist[:limit]


def _aggregate_similar_candidates(seed_paths: list[str], *, per_seed_limit: int = 40) -> list[dict]:
    aggregated: dict[str, dict] = {}
    for seed_path in seed_paths:
        for index, track in enumerate(get_similar_from_db(seed_path, limit=per_seed_limit)):
            track_path = track.get("track_path")
            if not track_path:
                continue
            entry = aggregated.setdefault(track_path, {**track, "_aggregate_score": 0.0, "_hits": 0})
            score = float(track.get("score") or 0.0)
            # Small position bias so earlier matches win ties more often.
            entry["_aggregate_score"] += score + max(0.0, (per_seed_limit - index) / (per_seed_limit * 100))
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

    return playlist[:limit]


def generate_album_radio(album_id: int, limit: int = 50, source_mix_ratio: float = 0.25) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT t.id AS track_id, t.path, t.title, t.artist, a.name AS album, t.duration,
                   t.navidrome_id, t.bliss_vector
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE a.id = %s
            ORDER BY t.disc_number, t.track_number
        """, (album_id,))
        album_tracks = [dict(row) for row in cur.fetchall()]

    if not album_tracks:
        return []

    source_tracks = [_radio_track_payload(track) for track in album_tracks]
    seed_paths = [track["path"] for track in album_tracks if track.get("path") and track.get("bliss_vector")]
    if not seed_paths:
        seed_paths = [track["path"] for track in album_tracks if track.get("path")]
    seed_paths = seed_paths[: min(4, len(seed_paths))]
    recommended_tracks = _aggregate_similar_candidates(seed_paths, per_seed_limit=max(limit, 40))

    return _interleave_radio_queue(
        source_tracks,
        recommended_tracks,
        limit=limit,
        source_mix_ratio=source_mix_ratio,
    )


def generate_playlist_radio(playlist_id: int, limit: int = 50, source_mix_ratio: float = 0.3) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT
                lt.id AS track_id,
                lt.path,
                COALESCE(pt.title, lt.title) AS title,
                COALESCE(pt.artist, lt.artist) AS artist,
                COALESCE(pt.album, lt.album) AS album,
                COALESCE(pt.duration, lt.duration, 0) AS duration,
                lt.navidrome_id,
                lt.bliss_vector
            FROM playlist_tracks pt
            LEFT JOIN LATERAL (
                SELECT id, path, title, artist, album, duration, navidrome_id, bliss_vector
                FROM library_tracks lt
                WHERE lt.path = pt.track_path
                   OR lt.path LIKE ('%%/' || pt.track_path)
                ORDER BY CASE WHEN lt.path = pt.track_path THEN 0 ELSE 1 END
                LIMIT 1
            ) lt ON TRUE
            WHERE pt.playlist_id = %s
            ORDER BY pt.position
        """, (playlist_id,))
        playlist_tracks = [dict(row) for row in cur.fetchall()]

    source_tracks = [_radio_track_payload(track) for track in playlist_tracks if track.get("path")]
    if not source_tracks:
        return []

    seed_paths = [track["path"] for track in playlist_tracks if track.get("path") and track.get("bliss_vector")]
    if not seed_paths:
        seed_paths = [track["path"] for track in playlist_tracks if track.get("path")]
    seed_paths = seed_paths[: min(5, len(seed_paths))]
    recommended_tracks = _aggregate_similar_candidates(seed_paths, per_seed_limit=max(limit, 40))

    return _interleave_radio_queue(
        source_tracks,
        recommended_tracks,
        limit=limit,
        source_mix_ratio=source_mix_ratio,
    )
