"""Integration with crate-cli Rust binary for bliss song distance/similarity."""

import logging

from musicdock.crate_cli import find_binary, is_available, run_bliss
from musicdock.db import get_db_ctx

log = logging.getLogger(__name__)


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


def generate_artist_radio(artist_name: str, limit: int = 50, mix_ratio: float = 0.4) -> list[dict]:
    """Generate an Artist Radio playlist: mix of artist tracks + similar tracks from other artists.

    mix_ratio: fraction of tracks from the artist (0.4 = 40% artist, 60% similar)
    """
    with get_db_ctx() as cur:
        # Get all bliss vectors for this artist
        cur.execute("""
            SELECT t.path, t.title, t.artist, a.name AS album, t.duration, t.bliss_vector
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
            SELECT t.path, t.title, t.artist, a.name AS album, t.duration,
                   SQRT(
                       (SELECT SUM(POW(x - y, 2))
                        FROM UNNEST(t.bliss_vector, %s::float8[]) AS v(x, y))
                   ) AS distance
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE t.bliss_vector IS NOT NULL AND a.artist != %s
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
        track_path = t["path"]
        if track_path.startswith("/music/"):
            track_path = track_path[len("/music/"):]
        playlist.append({
            "path": track_path,
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
                       (SELECT SUM(POW(x - y, 2))
                        FROM UNNEST(bliss_vector, %s::float8[]) AS v(x, y))
                   ) AS distance
            FROM library_tracks
            WHERE bliss_vector IS NOT NULL AND path != %s
            ORDER BY distance ASC
            LIMIT %s
        """, (source_vec, track_path, limit))

        return [dict(r) for r in cur.fetchall()]
