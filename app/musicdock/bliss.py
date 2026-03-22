"""Integration with grooveyard-bliss Rust CLI for song distance/similarity."""

import json
import logging
import shutil
import subprocess
from pathlib import Path

from musicdock.db import get_db_ctx

log = logging.getLogger(__name__)

BLISS_BIN = "grooveyard-bliss"


def _find_binary() -> str | None:
    """Find the grooveyard-bliss binary."""
    # Check common locations
    for path in [
        "/usr/local/bin/grooveyard-bliss",
        "/app/bin/grooveyard-bliss",
        shutil.which(BLISS_BIN),
    ]:
        if path and Path(path).is_file():
            return str(path)
    return None


def is_available() -> bool:
    return _find_binary() is not None


def analyze_file(filepath: str) -> list[float] | None:
    """Analyze a single file, return 20-float feature vector."""
    binary = _find_binary()
    if not binary:
        return None
    try:
        result = subprocess.run(
            [binary, "--file", filepath],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            log.warning("bliss failed for %s: %s", filepath, result.stderr)
            return None
        data = json.loads(result.stdout)
        if data.get("error"):
            log.warning("bliss error for %s: %s", filepath, data["error"])
            return None
        return data.get("features")
    except Exception:
        log.warning("bliss subprocess failed for %s", filepath, exc_info=True)
        return None


def analyze_directory(dirpath: str, extensions: str = "flac,mp3,m4a,ogg,opus") -> dict:
    """Analyze all files in a directory. Returns {path: features} dict."""
    binary = _find_binary()
    if not binary:
        return {}
    try:
        result = subprocess.run(
            [binary, "--dir", dirpath, "--extensions", extensions],
            capture_output=True, text=True, timeout=3600,
        )
        if result.returncode != 0:
            return {}
        data = json.loads(result.stdout)
        out = {}
        for track in data.get("tracks", []):
            if not track.get("error") and track.get("features"):
                out[track["path"]] = track["features"]
        return out
    except Exception:
        log.warning("bliss batch failed for %s", dirpath, exc_info=True)
        return {}


def find_similar(source_path: str, library_path: str, limit: int = 20) -> list[dict]:
    """Find similar tracks to source within the library."""
    binary = _find_binary()
    if not binary:
        return []
    try:
        result = subprocess.run(
            [binary, "--dir", library_path, "--similar-to", source_path, "--limit", str(limit)],
            capture_output=True, text=True, timeout=3600,
        )
        if result.returncode != 0:
            return []
        data = json.loads(result.stdout)
        return data.get("similar", [])
    except Exception:
        log.warning("bliss similar failed for %s", source_path, exc_info=True)
        return []


def store_vectors(vectors: dict[str, list[float]]):
    """Store bliss feature vectors in the database."""
    with get_db_ctx() as cur:
        for path, features in vectors.items():
            cur.execute(
                "UPDATE library_tracks SET bliss_vector = %s WHERE path = %s",
                (features, path),
            )


def generate_artist_radio(artist_name: str, limit: int = 50, mix_ratio: float = 0.4) -> list[dict]:
    """Generate an Artist Radio playlist: mix of artist tracks + similar tracks from other artists.

    mix_ratio: fraction of tracks from the artist (0.4 = 40% artist, 60% similar)
    """
    with get_db_ctx() as cur:
        # Get all bliss vectors for this artist
        cur.execute("""
            SELECT path, title, artist, album, duration, bliss_vector
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE a.artist = %s AND t.bliss_vector IS NOT NULL
        """, (artist_name,))
        artist_tracks = [dict(r) for r in cur.fetchall()]

        if not artist_tracks:
            return []

        import numpy as np

        # Compute centroid of artist's sound
        vectors = [t["bliss_vector"] for t in artist_tracks]
        centroid = np.mean(vectors, axis=0).tolist()

        # Find closest tracks from OTHER artists
        cur.execute("""
            SELECT path, title, artist, album, duration,
                   SQRT(
                       (SELECT SUM(POW(a - b, 2))
                        FROM UNNEST(bliss_vector, %s::float8[]) AS t(a, b))
                   ) AS distance
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE bliss_vector IS NOT NULL AND a.artist != %s
            ORDER BY distance ASC
            LIMIT %s
        """, (centroid, artist_name, limit))
        similar_tracks = [dict(r) for r in cur.fetchall()]

    # Mix: artist tracks + similar
    import random
    artist_count = max(1, int(limit * mix_ratio))
    similar_count = limit - artist_count

    picked_artist = random.sample(artist_tracks, min(artist_count, len(artist_tracks)))
    picked_similar = similar_tracks[:similar_count]

    # Interleave: start with artist, sprinkle similar
    playlist = []
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
        playlist.append({
            "path": t["path"],
            "title": t["title"],
            "artist": t["artist"],
            "album": t["album"],
            "duration": t.get("duration", 0),
            "distance": t.get("distance"),
        })

    return playlist


def get_similar_from_db(track_path: str, limit: int = 20) -> list[dict]:
    """Find similar tracks using pre-computed vectors stored in DB."""
    with get_db_ctx() as cur:
        cur.execute("SELECT bliss_vector FROM library_tracks WHERE path = %s", (track_path,))
        row = cur.fetchone()
        if not row or not row["bliss_vector"]:
            return []

        source_vec = row["bliss_vector"]

        # Calculate euclidean distance in SQL (PostgreSQL array math)
        # This is O(n) over all tracks but fast for < 100K tracks
        cur.execute("""
            SELECT path, title, artist, album, duration,
                   SQRT(
                       (SELECT SUM(POW(a - b, 2))
                        FROM UNNEST(bliss_vector, %s::float8[]) AS t(a, b))
                   ) AS distance
            FROM library_tracks
            WHERE bliss_vector IS NOT NULL AND path != %s
            ORDER BY distance ASC
            LIMIT %s
        """, (source_vec, track_path, limit))

        return [dict(r) for r in cur.fetchall()]
