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
