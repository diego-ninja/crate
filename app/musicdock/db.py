import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

_DB_PATH: Path | None = None


def _get_db_path() -> Path:
    global _DB_PATH
    if _DB_PATH is None:
        data_dir = os.environ.get("DATA_DIR", "/data")
        _DB_PATH = Path(data_dir) / "librarian.db"
    return _DB_PATH


def set_db_path(path: str | Path):
    global _DB_PATH
    _DB_PATH = Path(path)


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_get_db_path()), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def get_db_ctx():
    conn = get_db()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def db_retry(fn, *args, retries: int = 3, **kwargs):
    """Execute a DB function with retry on 'database is locked'."""
    import time as _time
    for attempt in range(retries):
        try:
            return fn(*args, **kwargs)
        except sqlite3.OperationalError as e:
            if "database is locked" in str(e) and attempt < retries - 1:
                _time.sleep(0.5 * (attempt + 1))
                continue
            raise


def init_db():
    _get_db_path().parent.mkdir(parents=True, exist_ok=True)
    with get_db_ctx() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                progress TEXT DEFAULT '',
                params_json TEXT DEFAULT '{}',
                result_json TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS scan_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT REFERENCES tasks(id),
                issues_json TEXT NOT NULL,
                scanned_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS mb_cache (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cache (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS dir_mtimes (
                path TEXT PRIMARY KEY,
                mtime REAL NOT NULL,
                data_json TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
            CREATE INDEX IF NOT EXISTS idx_mb_cache_created ON mb_cache(created_at);

            CREATE TABLE IF NOT EXISTS library_artists (
                name TEXT PRIMARY KEY,
                album_count INTEGER DEFAULT 0,
                track_count INTEGER DEFAULT 0,
                total_size INTEGER DEFAULT 0,
                formats_json TEXT DEFAULT '[]',
                primary_format TEXT,
                has_photo INTEGER DEFAULT 0,
                dir_mtime REAL,
                updated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS library_albums (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                artist TEXT NOT NULL REFERENCES library_artists(name),
                name TEXT NOT NULL,
                path TEXT UNIQUE NOT NULL,
                track_count INTEGER DEFAULT 0,
                total_size INTEGER DEFAULT 0,
                total_duration REAL DEFAULT 0,
                formats_json TEXT DEFAULT '[]',
                year TEXT,
                genre TEXT,
                has_cover INTEGER DEFAULT 0,
                musicbrainz_albumid TEXT,
                dir_mtime REAL,
                updated_at TEXT,
                UNIQUE(artist, name)
            );

            CREATE TABLE IF NOT EXISTS library_tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                album_id INTEGER REFERENCES library_albums(id) ON DELETE CASCADE,
                artist TEXT NOT NULL,
                album TEXT NOT NULL,
                filename TEXT NOT NULL,
                title TEXT,
                track_number INTEGER,
                disc_number INTEGER DEFAULT 1,
                format TEXT,
                bitrate INTEGER,
                duration REAL,
                size INTEGER,
                year TEXT,
                genre TEXT,
                albumartist TEXT,
                musicbrainz_albumid TEXT,
                musicbrainz_trackid TEXT,
                path TEXT UNIQUE NOT NULL,
                updated_at TEXT,
                -- AudioMuse sonic analysis (nullable, populated by AI enrichment)
                bpm REAL,
                audio_key TEXT,
                audio_scale TEXT,
                energy REAL,
                mood_json TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_lib_albums_artist ON library_albums(artist);
            CREATE INDEX IF NOT EXISTS idx_lib_tracks_album ON library_tracks(album_id);
            CREATE INDEX IF NOT EXISTS idx_lib_tracks_artist ON library_tracks(artist);
            CREATE INDEX IF NOT EXISTS idx_lib_tracks_genre ON library_tracks(genre);
            CREATE INDEX IF NOT EXISTS idx_lib_tracks_year ON library_tracks(year);
        """)


# ── Task CRUD ─────────────────────────────────────────────────────

def create_task(task_type: str, params: dict | None = None) -> str:
    task_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as conn:
        conn.execute(
            "INSERT INTO tasks (id, type, status, params_json, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?, ?)",
            (task_id, task_type, json.dumps(params or {}), now, now),
        )
    return task_id


def update_task(task_id: str, *, status: str | None = None, progress: str | None = None,
                result: dict | None = None, error: str | None = None):
    now = datetime.now(timezone.utc).isoformat()
    fields = ["updated_at = ?"]
    values: list = [now]

    if status is not None:
        fields.append("status = ?")
        values.append(status)
    if progress is not None:
        fields.append("progress = ?")
        values.append(progress)
    if result is not None:
        fields.append("result_json = ?")
        values.append(json.dumps(result))
    if error is not None:
        fields.append("error = ?")
        values.append(error)

    values.append(task_id)
    with get_db_ctx() as conn:
        conn.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id = ?", values)


def get_task(task_id: str) -> dict | None:
    with get_db_ctx() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return _row_to_task(row) if row else None


def list_tasks(status: str | None = None, task_type: str | None = None, limit: int = 50) -> list[dict]:
    query = "SELECT * FROM tasks WHERE 1=1"
    params: list = []
    if status:
        query += " AND status = ?"
        params.append(status)
    if task_type:
        query += " AND type = ?"
        params.append(task_type)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    with get_db_ctx() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_row_to_task(r) for r in rows]


def claim_next_task() -> dict | None:
    with get_db_ctx() as conn:
        row = conn.execute(
            "SELECT * FROM tasks WHERE status = 'pending' ORDER BY created_at LIMIT 1"
        ).fetchone()
        if not row:
            return None
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'",
            (now, row["id"]),
        )
    return _row_to_task(row) if row else None


def _row_to_task(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["params"] = json.loads(d.pop("params_json", "{}") or "{}")
    result_raw = d.pop("result_json", None)
    d["result"] = json.loads(result_raw) if result_raw else None
    return d


# ── Scan results ──────────────────────────────────────────────────

def save_scan_result(task_id: str, issues: list[dict]):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as conn:
        conn.execute(
            "INSERT INTO scan_results (task_id, issues_json, scanned_at) VALUES (?, ?, ?)",
            (task_id, json.dumps(issues), now),
        )


def get_latest_scan() -> dict | None:
    with get_db_ctx() as conn:
        row = conn.execute(
            "SELECT * FROM scan_results ORDER BY scanned_at DESC LIMIT 1"
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    d["issues"] = json.loads(d.pop("issues_json"))
    return d


# ── Settings ──────────────────────────────────────────────────────

def get_setting(key: str, default: str | None = None) -> str | None:
    with get_db_ctx() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str):
    with get_db_ctx() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
            (key, value, value),
        )


# ── MusicBrainz cache ───────────────────────────────────────────

def get_mb_cache(key: str) -> dict | None:
    with get_db_ctx() as conn:
        row = conn.execute("SELECT value_json FROM mb_cache WHERE key = ?", (key,)).fetchone()
    if not row:
        return None
    return json.loads(row["value_json"])


def set_mb_cache(key: str, value: dict):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as conn:
        conn.execute(
            "INSERT INTO mb_cache (key, value_json, created_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value_json = ?, created_at = ?",
            (key, json.dumps(value), now, json.dumps(value), now),
        )


# ── Generic cache ────────────────────────────────────────────────

def get_cache(key: str, max_age_seconds: int | None = None) -> dict | None:
    with get_db_ctx() as conn:
        row = conn.execute("SELECT value_json, updated_at FROM cache WHERE key = ?", (key,)).fetchone()
    if not row:
        return None
    if max_age_seconds is not None:
        updated = datetime.fromisoformat(row["updated_at"])
        age = (datetime.now(timezone.utc) - updated).total_seconds()
        if age > max_age_seconds:
            return None
    return json.loads(row["value_json"])


def set_cache(key: str, value: dict):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as conn:
        conn.execute(
            "INSERT INTO cache (key, value_json, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value_json = ?, updated_at = ?",
            (key, json.dumps(value), now, json.dumps(value), now),
        )


def delete_cache(key: str):
    with get_db_ctx() as conn:
        conn.execute("DELETE FROM cache WHERE key = ?", (key,))


# ── Directory mtime tracking ────────────────────────────────────

def get_dir_mtime(path: str) -> tuple[float, dict | None] | None:
    with get_db_ctx() as conn:
        row = conn.execute("SELECT mtime, data_json FROM dir_mtimes WHERE path = ?", (path,)).fetchone()
    if not row:
        return None
    data = json.loads(row["data_json"]) if row["data_json"] else None
    return (row["mtime"], data)


def set_dir_mtime(path: str, mtime: float, data: dict | None = None):
    with get_db_ctx() as conn:
        data_json = json.dumps(data) if data is not None else None
        conn.execute(
            "INSERT INTO dir_mtimes (path, mtime, data_json) VALUES (?, ?, ?) "
            "ON CONFLICT(path) DO UPDATE SET mtime = ?, data_json = ?",
            (path, mtime, data_json, mtime, data_json),
        )


def get_all_dir_mtimes(prefix: str = "") -> dict[str, tuple[float, dict | None]]:
    with get_db_ctx() as conn:
        if prefix:
            rows = conn.execute("SELECT path, mtime, data_json FROM dir_mtimes WHERE path LIKE ?", (prefix + "%",)).fetchall()
        else:
            rows = conn.execute("SELECT path, mtime, data_json FROM dir_mtimes").fetchall()
    result = {}
    for row in rows:
        data = json.loads(row["data_json"]) if row["data_json"] else None
        result[row["path"]] = (row["mtime"], data)
    return result


def delete_dir_mtime(path: str):
    with get_db_ctx() as conn:
        conn.execute("DELETE FROM dir_mtimes WHERE path = ?", (path,))


# ── Library helpers ──────────────────────────────────────────────

def get_library_artists(q: str | None = None, sort: str = "name",
                        page: int = 1, per_page: int = 60) -> tuple[list[dict], int]:
    query = "SELECT * FROM library_artists WHERE 1=1"
    count_query = "SELECT COUNT(*) FROM library_artists WHERE 1=1"
    params: list = []
    count_params: list = []

    if q:
        query += " AND name LIKE ?"
        count_query += " AND name LIKE ?"
        like = f"%{q}%"
        params.append(like)
        count_params.append(like)

    sort_map = {
        "name": "name ASC",
        "albums": "album_count DESC",
        "tracks": "track_count DESC",
        "size": "total_size DESC",
        "updated": "updated_at DESC",
    }
    query += f" ORDER BY {sort_map.get(sort, 'name ASC')}"
    query += " LIMIT ? OFFSET ?"
    params.extend([per_page, (page - 1) * per_page])

    with get_db_ctx() as conn:
        total = conn.execute(count_query, count_params).fetchone()[0]
        rows = conn.execute(query, params).fetchall()
    return [_row_to_lib_artist(r) for r in rows], total


def get_library_artist(name: str) -> dict | None:
    with get_db_ctx() as conn:
        row = conn.execute("SELECT * FROM library_artists WHERE name = ?", (name,)).fetchone()
    return _row_to_lib_artist(row) if row else None


def get_library_albums(artist: str) -> list[dict]:
    with get_db_ctx() as conn:
        rows = conn.execute(
            "SELECT * FROM library_albums WHERE artist = ? ORDER BY year, name", (artist,)
        ).fetchall()
    return [_row_to_lib_album(r) for r in rows]


def get_library_album(artist: str, album: str) -> dict | None:
    with get_db_ctx() as conn:
        row = conn.execute(
            "SELECT * FROM library_albums WHERE artist = ? AND name = ?", (artist, album)
        ).fetchone()
    return _row_to_lib_album(row) if row else None


def get_library_tracks(album_id: int) -> list[dict]:
    with get_db_ctx() as conn:
        rows = conn.execute(
            "SELECT * FROM library_tracks WHERE album_id = ? ORDER BY disc_number, track_number",
            (album_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_library_stats() -> dict:
    with get_db_ctx() as conn:
        artists = conn.execute("SELECT COUNT(*) FROM library_artists").fetchone()[0]
        albums = conn.execute("SELECT COUNT(*) FROM library_albums").fetchone()[0]
        tracks = conn.execute("SELECT COUNT(*) FROM library_tracks").fetchone()[0]
        size = conn.execute("SELECT COALESCE(SUM(total_size), 0) FROM library_artists").fetchone()[0]
        fmt_rows = conn.execute(
            "SELECT format, COUNT(*) as cnt FROM library_tracks WHERE format IS NOT NULL GROUP BY format ORDER BY cnt DESC"
        ).fetchall()
    formats = {r["format"]: r["cnt"] for r in fmt_rows}
    return {
        "artists": artists,
        "albums": albums,
        "tracks": tracks,
        "total_size": size,
        "formats": formats,
    }


def get_library_track_count() -> int:
    with get_db_ctx() as conn:
        return conn.execute("SELECT COUNT(*) FROM library_tracks").fetchone()[0]


def upsert_artist(data: dict):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as conn:
        conn.execute("""
            INSERT INTO library_artists (name, album_count, track_count, total_size,
                formats_json, primary_format, has_photo, dir_mtime, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                album_count=excluded.album_count, track_count=excluded.track_count,
                total_size=excluded.total_size, formats_json=excluded.formats_json,
                primary_format=excluded.primary_format, has_photo=excluded.has_photo,
                dir_mtime=excluded.dir_mtime, updated_at=excluded.updated_at
        """, (
            data["name"], data.get("album_count", 0), data.get("track_count", 0),
            data.get("total_size", 0), json.dumps(data.get("formats", [])),
            data.get("primary_format"), data.get("has_photo", 0),
            data.get("dir_mtime"), now,
        ))


def upsert_album(data: dict) -> int:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as conn:
        conn.execute("""
            INSERT INTO library_albums (artist, name, path, track_count, total_size,
                total_duration, formats_json, year, genre, has_cover,
                musicbrainz_albumid, dir_mtime, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                artist=excluded.artist, name=excluded.name,
                track_count=excluded.track_count, total_size=excluded.total_size,
                total_duration=excluded.total_duration, formats_json=excluded.formats_json,
                year=excluded.year, genre=excluded.genre, has_cover=excluded.has_cover,
                musicbrainz_albumid=excluded.musicbrainz_albumid,
                dir_mtime=excluded.dir_mtime, updated_at=excluded.updated_at
        """, (
            data["artist"], data["name"], data["path"],
            data.get("track_count", 0), data.get("total_size", 0),
            data.get("total_duration", 0), json.dumps(data.get("formats", [])),
            data.get("year"), data.get("genre"), data.get("has_cover", 0),
            data.get("musicbrainz_albumid"), data.get("dir_mtime"), now,
        ))
        row = conn.execute("SELECT id FROM library_albums WHERE path = ?", (data["path"],)).fetchone()
    return row["id"]


def upsert_track(data: dict):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as conn:
        conn.execute("""
            INSERT INTO library_tracks (album_id, artist, album, filename, title,
                track_number, disc_number, format, bitrate, duration, size,
                year, genre, albumartist, musicbrainz_albumid, musicbrainz_trackid,
                path, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                album_id=excluded.album_id, artist=excluded.artist, album=excluded.album,
                filename=excluded.filename, title=excluded.title,
                track_number=excluded.track_number, disc_number=excluded.disc_number,
                format=excluded.format, bitrate=excluded.bitrate,
                duration=excluded.duration, size=excluded.size,
                year=excluded.year, genre=excluded.genre, albumartist=excluded.albumartist,
                musicbrainz_albumid=excluded.musicbrainz_albumid,
                musicbrainz_trackid=excluded.musicbrainz_trackid,
                updated_at=excluded.updated_at
        """, (
            data.get("album_id"), data["artist"], data["album"],
            data["filename"], data.get("title"), data.get("track_number"),
            data.get("disc_number", 1), data.get("format"), data.get("bitrate"),
            data.get("duration"), data.get("size"), data.get("year"),
            data.get("genre"), data.get("albumartist"),
            data.get("musicbrainz_albumid"), data.get("musicbrainz_trackid"),
            data["path"], now,
        ))


def update_track_audiomuse(path: str, bpm: float | None, key: str | None,
                          scale: str | None, energy: float | None, mood: dict | None):
    """Update AudioMuse sonic analysis fields for a track."""
    with get_db_ctx() as conn:
        conn.execute(
            "UPDATE library_tracks SET bpm=?, audio_key=?, audio_scale=?, energy=?, mood_json=? WHERE path=?",
            (bpm, key, scale, energy, json.dumps(mood) if mood else None, path),
        )


def delete_artist(name: str):
    with get_db_ctx() as conn:
        album_ids = [r["id"] for r in conn.execute(
            "SELECT id FROM library_albums WHERE artist = ?", (name,)
        ).fetchall()]
        for aid in album_ids:
            conn.execute("DELETE FROM library_tracks WHERE album_id = ?", (aid,))
        conn.execute("DELETE FROM library_albums WHERE artist = ?", (name,))
        conn.execute("DELETE FROM library_artists WHERE name = ?", (name,))


def delete_album(path: str):
    with get_db_ctx() as conn:
        row = conn.execute("SELECT id FROM library_albums WHERE path = ?", (path,)).fetchone()
        if row:
            conn.execute("DELETE FROM library_tracks WHERE album_id = ?", (row["id"],))
            conn.execute("DELETE FROM library_albums WHERE path = ?", (path,))


def delete_track(path: str):
    with get_db_ctx() as conn:
        conn.execute("DELETE FROM library_tracks WHERE path = ?", (path,))


def _row_to_lib_artist(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["formats"] = json.loads(d.pop("formats_json", "[]") or "[]")
    return d


def _row_to_lib_album(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["formats"] = json.loads(d.pop("formats_json", "[]") or "[]")
    return d
