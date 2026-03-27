"""AudioMuse-AI integration — sonic analysis data for tracks."""

import json
import logging
import os
import requests

log = logging.getLogger(__name__)

AUDIOMUSE_URL = os.environ.get("AUDIOMUSE_URL", "http://audiomuse:8000")


def _get(path: str, params: dict | None = None, timeout: int = 10) -> dict | list | None:
    try:
        resp = requests.get(f"{AUDIOMUSE_URL}{path}", params=params, timeout=timeout)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        log.debug("AudioMuse request failed: %s — %s", path, e)
        return None


def _post(path: str, data: dict | None = None, timeout: int = 30) -> dict | None:
    try:
        resp = requests.post(f"{AUDIOMUSE_URL}{path}", json=data, timeout=timeout)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        log.debug("AudioMuse POST failed: %s — %s", path, e)
        return None


def ping() -> dict | None:
    return _get("/api/config")


def start_collection_sync() -> dict | None:
    """Trigger collection sync (fetches tracks from Navidrome)."""
    return _post("/api/collection/start")


def start_analysis() -> dict | None:
    """Trigger audio analysis of synced collection."""
    return _post("/api/analysis/start")


def start_clustering() -> dict | None:
    """Trigger clustering after analysis."""
    return _post("/api/clustering/start")


def get_task_status(task_id: str) -> dict | None:
    return _get(f"/api/status/{task_id}")


def get_active_tasks() -> dict | None:
    return _get("/api/active_tasks")


def get_last_task() -> dict | None:
    return _get("/api/last_task")


def search_artists(query: str) -> list:
    result = _get("/api/search_artists", params={"q": query})
    if isinstance(result, list):
        return result
    return []


def get_similar_artists(artist: str, count: int = 10) -> list:
    result = _get("/api/similar_artists", params={"artist": artist, "count": count})
    if isinstance(result, list):
        return result
    return []


def get_artist_tracks(artist: str) -> list:
    result = _get("/api/artist_tracks", params={"artist": artist})
    if isinstance(result, list):
        return result
    return []


def get_track_data_from_db(item_ids: list[str]) -> dict[str, dict]:
    """Query AudioMuse PostgreSQL directly for track analysis data.
    Returns {item_id: {tempo, key, scale, energy, mood_vector}} for analyzed tracks."""
    import psycopg2

    pg_host = os.environ.get("AUDIOMUSE_POSTGRES_HOST", "audiomuse-postgres")
    pg_user = os.environ.get("AUDIOMUSE_POSTGRES_USER", "audiomuse")
    pg_pass = os.environ.get("AUDIOMUSE_POSTGRES_PASSWORD", "audiomusepassword")
    pg_db = os.environ.get("AUDIOMUSE_POSTGRES_DB", "audiomusedb")

    try:
        conn = psycopg2.connect(host=pg_host, user=pg_user, password=pg_pass, dbname=pg_db, connect_timeout=5)
        cur = conn.cursor()

        placeholders = ",".join(["%s"] * len(item_ids))
        cur.execute(
            f"SELECT item_id, tempo, key, scale, energy, mood_vector FROM score WHERE item_id IN ({placeholders})",
            item_ids,
        )

        result = {}
        for row in cur.fetchall():
            mood = None
            if row[5]:
                try:
                    mood = json.loads(row[5])
                except (json.JSONDecodeError, TypeError):
                    mood = None

            result[row[0]] = {
                "tempo": round(row[1]) if row[1] else None,
                "key": row[2],
                "scale": row[3],
                "energy": round(row[4], 2) if row[4] else None,
                "mood": mood,
            }

        cur.close()
        conn.close()
        return result
    except Exception as e:
        log.warning("AudioMuse DB query failed: %s", e)
        return {}


def get_track_data_by_titles(artist: str, titles: list[str]) -> dict[str, dict]:
    """Query AudioMuse by artist+title. Returns {title_lower: {tempo, key, scale, energy}}."""
    import psycopg2

    pg_host = os.environ.get("AUDIOMUSE_POSTGRES_HOST", "audiomuse-postgres")
    pg_user = os.environ.get("AUDIOMUSE_POSTGRES_USER", "audiomuse")
    pg_pass = os.environ.get("AUDIOMUSE_POSTGRES_PASSWORD", "audiomusepassword")
    pg_db = os.environ.get("AUDIOMUSE_POSTGRES_DB", "audiomusedb")

    try:
        conn = psycopg2.connect(host=pg_host, user=pg_user, password=pg_pass, dbname=pg_db, connect_timeout=5)
        cur = conn.cursor()
        cur.execute(
            "SELECT title, tempo, key, scale, energy FROM score WHERE LOWER(author) = LOWER(%s) AND tempo IS NOT NULL",
            (artist,),
        )

        result = {}
        for row in cur.fetchall():
            result[row[0].lower()] = {
                "tempo": round(row[1]) if row[1] else None,
                "key": row[2],
                "scale": row[3],
                "energy": round(row[4], 2) if row[4] else None,
            }

        cur.close()
        conn.close()
        return result
    except Exception as e:
        log.warning("AudioMuse title query failed: %s", e)
        return {}


def get_analyzed_count() -> int:
    """Get count of analyzed tracks."""
    import psycopg2

    pg_host = os.environ.get("AUDIOMUSE_POSTGRES_HOST", "audiomuse-postgres")
    pg_user = os.environ.get("AUDIOMUSE_POSTGRES_USER", "audiomuse")
    pg_pass = os.environ.get("AUDIOMUSE_POSTGRES_PASSWORD", "audiomusepassword")
    pg_db = os.environ.get("AUDIOMUSE_POSTGRES_DB", "audiomusedb")

    try:
        conn = psycopg2.connect(host=pg_host, user=pg_user, password=pg_pass, dbname=pg_db, connect_timeout=5)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM score WHERE tempo IS NOT NULL")
        count = cur.fetchone()[0]
        cur.close()
        conn.close()
        return count
    except Exception:
        return 0
