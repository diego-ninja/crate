import json
import os
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
import psycopg2.pool

_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def _get_dsn() -> str:
    user = os.environ.get("MUSICDOCK_POSTGRES_USER", "musicdock")
    password = os.environ.get("MUSICDOCK_POSTGRES_PASSWORD", "musicdock")
    host = os.environ.get("MUSICDOCK_POSTGRES_HOST", "musicdock-postgres")
    port = os.environ.get("MUSICDOCK_POSTGRES_PORT", "5432")
    db = os.environ.get("MUSICDOCK_POSTGRES_DB", "musicdock")
    return f"postgresql://{user}:{password}@{host}:{port}/{db}"


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None or _pool.closed:
        for attempt in range(10):
            try:
                _pool = psycopg2.pool.ThreadedConnectionPool(
                    minconn=2, maxconn=30, dsn=_get_dsn()
                )
                break
            except psycopg2.OperationalError:
                if attempt < 9:
                    time.sleep(2)
                else:
                    raise
    return _pool


def get_db():
    pool = _get_pool()
    conn = pool.getconn()
    return conn


@contextmanager
def get_db_ctx():
    pool = _get_pool()
    for attempt in range(3):
        try:
            conn = pool.getconn()
            break
        except psycopg2.pool.PoolError:
            if attempt < 2:
                time.sleep(0.5)
            else:
                raise
    try:
        conn.autocommit = False
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            cur.close()
        except Exception:
            pass
        pool.putconn(conn)


def init_db():
    with get_db_ctx() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                progress TEXT DEFAULT '',
                params_json JSONB DEFAULT '{}',
                result_json JSONB,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS scan_results (
                id SERIAL PRIMARY KEY,
                task_id TEXT REFERENCES tasks(id),
                issues_json JSONB NOT NULL,
                scanned_at TEXT NOT NULL
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS mb_cache (
                key TEXT PRIMARY KEY,
                value_json JSONB NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cache (
                key TEXT PRIMARY KEY,
                value_json JSONB NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS dir_mtimes (
                path TEXT PRIMARY KEY,
                mtime DOUBLE PRECISION NOT NULL,
                data_json JSONB
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                username TEXT UNIQUE,
                name TEXT,
                password_hash TEXT,
                avatar TEXT,
                role TEXT NOT NULL DEFAULT 'user',
                google_id TEXT UNIQUE,
                created_at TEXT NOT NULL,
                last_login TEXT
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)")

        # Migration: add username column if missing
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE users ADD COLUMN username TEXT UNIQUE;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)

        _seed_admin(cur)

        cur.execute("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_mb_cache_created ON mb_cache(created_at)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS library_artists (
                name TEXT PRIMARY KEY,
                album_count INTEGER DEFAULT 0,
                track_count INTEGER DEFAULT 0,
                total_size BIGINT DEFAULT 0,
                formats_json JSONB DEFAULT '[]',
                primary_format TEXT,
                has_photo INTEGER DEFAULT 0,
                dir_mtime DOUBLE PRECISION,
                updated_at TEXT
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS library_albums (
                id SERIAL PRIMARY KEY,
                artist TEXT NOT NULL REFERENCES library_artists(name),
                name TEXT NOT NULL,
                path TEXT UNIQUE NOT NULL,
                track_count INTEGER DEFAULT 0,
                total_size BIGINT DEFAULT 0,
                total_duration DOUBLE PRECISION DEFAULT 0,
                formats_json JSONB DEFAULT '[]',
                year TEXT,
                genre TEXT,
                has_cover INTEGER DEFAULT 0,
                musicbrainz_albumid TEXT,
                dir_mtime DOUBLE PRECISION,
                updated_at TEXT,
                UNIQUE(artist, name)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS library_tracks (
                id SERIAL PRIMARY KEY,
                album_id INTEGER REFERENCES library_albums(id) ON DELETE CASCADE,
                artist TEXT NOT NULL,
                album TEXT NOT NULL,
                filename TEXT NOT NULL,
                title TEXT,
                track_number INTEGER,
                disc_number INTEGER DEFAULT 1,
                format TEXT,
                bitrate INTEGER,
                duration DOUBLE PRECISION,
                size BIGINT,
                year TEXT,
                genre TEXT,
                albumartist TEXT,
                musicbrainz_albumid TEXT,
                musicbrainz_trackid TEXT,
                path TEXT UNIQUE NOT NULL,
                updated_at TEXT,
                bpm DOUBLE PRECISION,
                audio_key TEXT,
                audio_scale TEXT,
                energy DOUBLE PRECISION,
                mood_json JSONB
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_lib_albums_artist ON library_albums(artist)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_lib_tracks_album ON library_tracks(album_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_lib_tracks_artist ON library_tracks(artist)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_lib_tracks_genre ON library_tracks(genre)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_lib_tracks_year ON library_tracks(year)")

        # Migration: add extended audio analysis columns
        for col in ("danceability", "valence", "acousticness", "instrumentalness",
                     "loudness", "dynamic_range", "spectral_complexity"):
            cur.execute(f"""
                DO $$ BEGIN
                    ALTER TABLE library_tracks ADD COLUMN {col} DOUBLE PRECISION;
                EXCEPTION WHEN duplicate_column THEN NULL;
                END $$
            """)

        # Migration: add folder_name to library_artists (filesystem dir name, may differ from canonical name)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE library_artists ADD COLUMN folder_name TEXT;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)

        # Migration: add enrichment columns to library_artists
        for col, col_type in [
            ("bio", "TEXT"), ("tags_json", "JSONB"), ("similar_json", "JSONB"),
            ("spotify_id", "TEXT"), ("spotify_popularity", "INTEGER"),
            ("mbid", "TEXT"), ("country", "TEXT"), ("area", "TEXT"),
            ("formed", "TEXT"), ("ended", "TEXT"), ("artist_type", "TEXT"),
            ("members_json", "JSONB"), ("urls_json", "JSONB"),
            ("listeners", "INTEGER"), ("enriched_at", "TEXT"),
        ]:
            cur.execute(f"""
                DO $$ BEGIN
                    ALTER TABLE library_artists ADD COLUMN {col} {col_type};
                EXCEPTION WHEN duplicate_column THEN NULL;
                END $$
            """)

        # Migration: add tag_album to library_albums (album name from audio tags, may differ from folder name)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE library_albums ADD COLUMN tag_album TEXT;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)

        # Genres
        cur.execute("""
            CREATE TABLE IF NOT EXISTS genres (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                slug TEXT UNIQUE NOT NULL
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS artist_genres (
                artist_name TEXT NOT NULL REFERENCES library_artists(name) ON DELETE CASCADE,
                genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
                weight DOUBLE PRECISION DEFAULT 1.0,
                source TEXT DEFAULT 'tags',
                PRIMARY KEY (artist_name, genre_id)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS album_genres (
                album_id INTEGER NOT NULL REFERENCES library_albums(id) ON DELETE CASCADE,
                genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
                weight DOUBLE PRECISION DEFAULT 1.0,
                source TEXT DEFAULT 'tags',
                PRIMARY KEY (album_id, genre_id)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_artist_genres_genre ON artist_genres(genre_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_album_genres_genre ON album_genres(genre_id)")

        # Playlists
        cur.execute("""
            CREATE TABLE IF NOT EXISTS playlists (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                user_id INTEGER REFERENCES users(id),
                is_smart BOOLEAN DEFAULT FALSE,
                smart_rules_json JSONB,
                track_count INTEGER DEFAULT 0,
                total_duration DOUBLE PRECISION DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS playlist_tracks (
                id SERIAL PRIMARY KEY,
                playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                track_path TEXT NOT NULL,
                title TEXT,
                artist TEXT,
                album TEXT,
                duration DOUBLE PRECISION DEFAULT 0,
                position INTEGER NOT NULL,
                added_at TEXT NOT NULL
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id, position)")

        # Audit log
        cur.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id SERIAL PRIMARY KEY,
                timestamp TEXT NOT NULL,
                action TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_name TEXT NOT NULL,
                details_json JSONB DEFAULT '{}',
                user_id INTEGER,
                task_id TEXT
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC)")


# ── Task CRUD ─────────────────────────────────────────────────────

def create_task(task_type: str, params: dict | None = None) -> str:
    task_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO tasks (id, type, status, params_json, created_at, updated_at) VALUES (%s, %s, 'pending', %s, %s, %s)",
            (task_id, task_type, json.dumps(params or {}), now, now),
        )
    return task_id


def update_task(task_id: str, *, status: str | None = None, progress: str | None = None,
                result: dict | None = None, error: str | None = None):
    now = datetime.now(timezone.utc).isoformat()
    fields = ["updated_at = %s"]
    values: list = [now]

    if status is not None:
        fields.append("status = %s")
        values.append(status)
    if progress is not None:
        fields.append("progress = %s")
        values.append(progress)
    if result is not None:
        fields.append("result_json = %s")
        values.append(json.dumps(result))
    if error is not None:
        fields.append("error = %s")
        values.append(error)

    values.append(task_id)
    with get_db_ctx() as cur:
        cur.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id = %s", values)


def get_task(task_id: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM tasks WHERE id = %s", (task_id,))
        row = cur.fetchone()
    return _row_to_task(row) if row else None


def list_tasks(status: str | None = None, task_type: str | None = None, limit: int = 50) -> list[dict]:
    query = "SELECT * FROM tasks WHERE 1=1"
    params: list = []
    if status:
        query += " AND status = %s"
        params.append(status)
    if task_type:
        query += " AND type = %s"
        params.append(task_type)
    query += " ORDER BY created_at DESC LIMIT %s"
    params.append(limit)

    with get_db_ctx() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()
    return [_row_to_task(r) for r in rows]


def claim_next_task() -> dict | None:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM tasks WHERE status = 'pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED"
        )
        row = cur.fetchone()
        if not row:
            return None
        now = datetime.now(timezone.utc).isoformat()
        cur.execute(
            "UPDATE tasks SET status = 'running', updated_at = %s WHERE id = %s AND status = 'pending'",
            (now, row["id"]),
        )
    return _row_to_task(row) if row else None


def _row_to_task(row: dict) -> dict:
    d = dict(row)
    params_raw = d.pop("params_json", {})
    d["params"] = params_raw if isinstance(params_raw, dict) else json.loads(params_raw or "{}")
    result_raw = d.pop("result_json", None)
    d["result"] = result_raw if isinstance(result_raw, (dict, list)) else (json.loads(result_raw) if result_raw else None)
    return d


# ── Scan results ──────────────────────────────────────────────────

def save_scan_result(task_id: str, issues: list[dict]):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO scan_results (task_id, issues_json, scanned_at) VALUES (%s, %s, %s)",
            (task_id, json.dumps(issues), now),
        )


def get_latest_scan() -> dict | None:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM scan_results ORDER BY scanned_at DESC LIMIT 1"
        )
        row = cur.fetchone()
    if not row:
        return None
    d = dict(row)
    issues_raw = d.pop("issues_json")
    d["issues"] = issues_raw if isinstance(issues_raw, list) else json.loads(issues_raw)
    return d


# ── Settings ──────────────────────────────────────────────────────

def get_setting(key: str, default: str | None = None) -> str | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
        row = cur.fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str):
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO settings (key, value) VALUES (%s, %s) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value",
            (key, value),
        )


# ── MusicBrainz cache ───────────────────────────────────────────

def get_mb_cache(key: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT value_json FROM mb_cache WHERE key = %s", (key,))
        row = cur.fetchone()
    if not row:
        return None
    val = row["value_json"]
    return val if isinstance(val, dict) else json.loads(val)


def set_mb_cache(key: str, value: dict):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO mb_cache (key, value_json, created_at) VALUES (%s, %s, %s) "
            "ON CONFLICT(key) DO UPDATE SET value_json = EXCLUDED.value_json, created_at = EXCLUDED.created_at",
            (key, json.dumps(value), now),
        )


# ── Generic cache ────────────────────────────────────────────────

def get_cache(key: str, max_age_seconds: int | None = None) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT value_json, updated_at FROM cache WHERE key = %s", (key,))
        row = cur.fetchone()
    if not row:
        return None
    if max_age_seconds is not None:
        updated = datetime.fromisoformat(row["updated_at"])
        age = (datetime.now(timezone.utc) - updated).total_seconds()
        if age > max_age_seconds:
            return None
    val = row["value_json"]
    return val if isinstance(val, (dict, list)) else json.loads(val)


def set_cache(key: str, value: dict):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO cache (key, value_json, updated_at) VALUES (%s, %s, %s) "
            "ON CONFLICT(key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = EXCLUDED.updated_at",
            (key, json.dumps(value), now),
        )


def delete_cache(key: str):
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM cache WHERE key = %s", (key,))


# ── Directory mtime tracking ────────────────────────────────────

def get_dir_mtime(path: str) -> tuple[float, dict | None] | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT mtime, data_json FROM dir_mtimes WHERE path = %s", (path,))
        row = cur.fetchone()
    if not row:
        return None
    data = row["data_json"]
    if isinstance(data, str):
        data = json.loads(data)
    return (row["mtime"], data)


def set_dir_mtime(path: str, mtime: float, data: dict | None = None):
    with get_db_ctx() as cur:
        data_json = json.dumps(data) if data is not None else None
        cur.execute(
            "INSERT INTO dir_mtimes (path, mtime, data_json) VALUES (%s, %s, %s) "
            "ON CONFLICT(path) DO UPDATE SET mtime = EXCLUDED.mtime, data_json = EXCLUDED.data_json",
            (path, mtime, data_json),
        )


def get_all_dir_mtimes(prefix: str = "") -> dict[str, tuple[float, dict | None]]:
    with get_db_ctx() as cur:
        if prefix:
            cur.execute("SELECT path, mtime, data_json FROM dir_mtimes WHERE path LIKE %s", (prefix + "%",))
        else:
            cur.execute("SELECT path, mtime, data_json FROM dir_mtimes")
        rows = cur.fetchall()
    result = {}
    for row in rows:
        data = row["data_json"]
        if isinstance(data, str):
            data = json.loads(data)
        result[row["path"]] = (row["mtime"], data)
    return result


def delete_dir_mtime(path: str):
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM dir_mtimes WHERE path = %s", (path,))


# ── Library helpers ──────────────────────────────────────────────

def get_library_artists(q: str | None = None, sort: str = "name",
                        page: int = 1, per_page: int = 60) -> tuple[list[dict], int]:
    query = "SELECT * FROM library_artists WHERE 1=1"
    count_query = "SELECT COUNT(*) AS cnt FROM library_artists WHERE 1=1"
    params: list = []
    count_params: list = []

    if q:
        query += " AND name ILIKE %s"
        count_query += " AND name ILIKE %s"
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
    query += " LIMIT %s OFFSET %s"
    params.extend([per_page, (page - 1) * per_page])

    with get_db_ctx() as cur:
        cur.execute(count_query, count_params)
        total = cur.fetchone()["cnt"]
        cur.execute(query, params)
        rows = cur.fetchall()
    return [_row_to_lib_artist(r) for r in rows], total


def get_library_artist(name: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM library_artists WHERE LOWER(name) = LOWER(%s) OR folder_name = %s",
            (name, name),
        )
        row = cur.fetchone()
    return _row_to_lib_artist(row) if row else None


def get_library_albums(artist: str) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM library_albums WHERE artist = %s ORDER BY year, name", (artist,)
        )
        rows = cur.fetchall()
    return [_row_to_lib_album(r) for r in rows]


def get_library_album(artist: str, album: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM library_albums WHERE artist = %s AND name = %s", (artist, album)
        )
        row = cur.fetchone()
    return _row_to_lib_album(row) if row else None


def get_library_tracks(album_id: int) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM library_tracks WHERE album_id = %s ORDER BY disc_number, track_number",
            (album_id,),
        )
        rows = cur.fetchall()
    results = []
    for r in rows:
        d = dict(r)
        mood = d.get("mood_json")
        if mood is not None and isinstance(mood, str):
            d["mood_json"] = json.loads(mood)
        results.append(d)
    return results


def get_library_stats() -> dict:
    with get_db_ctx() as cur:
        cur.execute("SELECT COUNT(*) AS cnt FROM library_artists")
        artists = cur.fetchone()["cnt"]
        cur.execute("SELECT COUNT(*) AS cnt FROM library_albums")
        albums = cur.fetchone()["cnt"]
        cur.execute("SELECT COUNT(*) AS cnt FROM library_tracks")
        tracks = cur.fetchone()["cnt"]
        cur.execute("SELECT COALESCE(SUM(total_size), 0) AS total FROM library_artists")
        size = cur.fetchone()["total"]
        cur.execute(
            "SELECT format, COUNT(*) as cnt FROM library_tracks WHERE format IS NOT NULL GROUP BY format ORDER BY cnt DESC"
        )
        fmt_rows = cur.fetchall()
    formats = {r["format"]: r["cnt"] for r in fmt_rows}
    return {
        "artists": artists,
        "albums": albums,
        "tracks": tracks,
        "total_size": size,
        "formats": formats,
    }


def get_library_track_count() -> int:
    with get_db_ctx() as cur:
        cur.execute("SELECT COUNT(*) AS cnt FROM library_tracks")
        return cur.fetchone()["cnt"]


def upsert_artist(data: dict):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute("""
            INSERT INTO library_artists (name, folder_name, album_count, track_count, total_size,
                formats_json, primary_format, has_photo, dir_mtime, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT(name) DO UPDATE SET
                folder_name=COALESCE(library_artists.folder_name, EXCLUDED.folder_name),
                album_count=EXCLUDED.album_count, track_count=EXCLUDED.track_count,
                total_size=EXCLUDED.total_size, formats_json=EXCLUDED.formats_json,
                primary_format=EXCLUDED.primary_format, has_photo=EXCLUDED.has_photo,
                dir_mtime=EXCLUDED.dir_mtime, updated_at=EXCLUDED.updated_at
        """, (
            data["name"], data.get("folder_name") or data["name"],
            data.get("album_count", 0), data.get("track_count", 0),
            data.get("total_size", 0), json.dumps(data.get("formats", [])),
            data.get("primary_format"), data.get("has_photo", 0),
            data.get("dir_mtime"), now,
        ))


def upsert_album(data: dict) -> int:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute("""
            INSERT INTO library_albums (artist, name, path, track_count, total_size,
                total_duration, formats_json, year, genre, has_cover,
                musicbrainz_albumid, tag_album, dir_mtime, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT(path) DO UPDATE SET
                artist=EXCLUDED.artist, name=EXCLUDED.name,
                track_count=EXCLUDED.track_count, total_size=EXCLUDED.total_size,
                total_duration=EXCLUDED.total_duration, formats_json=EXCLUDED.formats_json,
                year=EXCLUDED.year, genre=EXCLUDED.genre, has_cover=EXCLUDED.has_cover,
                musicbrainz_albumid=EXCLUDED.musicbrainz_albumid,
                tag_album=COALESCE(EXCLUDED.tag_album, library_albums.tag_album),
                dir_mtime=EXCLUDED.dir_mtime, updated_at=EXCLUDED.updated_at
        """, (
            data["artist"], data["name"], data["path"],
            data.get("track_count", 0), data.get("total_size", 0),
            data.get("total_duration", 0), json.dumps(data.get("formats", [])),
            data.get("year"), data.get("genre"), data.get("has_cover", 0),
            data.get("musicbrainz_albumid"), data.get("tag_album"),
            data.get("dir_mtime"), now,
        ))
        cur.execute("SELECT id FROM library_albums WHERE path = %s", (data["path"],))
        row = cur.fetchone()
    return row["id"]


def upsert_track(data: dict):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute("""
            INSERT INTO library_tracks (album_id, artist, album, filename, title,
                track_number, disc_number, format, bitrate, duration, size,
                year, genre, albumartist, musicbrainz_albumid, musicbrainz_trackid,
                path, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT(path) DO UPDATE SET
                album_id=EXCLUDED.album_id, artist=EXCLUDED.artist, album=EXCLUDED.album,
                filename=EXCLUDED.filename, title=EXCLUDED.title,
                track_number=EXCLUDED.track_number, disc_number=EXCLUDED.disc_number,
                format=EXCLUDED.format, bitrate=EXCLUDED.bitrate,
                duration=EXCLUDED.duration, size=EXCLUDED.size,
                year=EXCLUDED.year, genre=EXCLUDED.genre, albumartist=EXCLUDED.albumartist,
                musicbrainz_albumid=EXCLUDED.musicbrainz_albumid,
                musicbrainz_trackid=EXCLUDED.musicbrainz_trackid,
                updated_at=EXCLUDED.updated_at
                -- Preserve AudioMuse fields (don't overwrite with NULL)
                -- bpm, audio_key, audio_scale, energy, mood_json are NOT touched
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
                          scale: str | None, energy: float | None, mood: dict | None,
                          danceability: float | None = None, valence: float | None = None,
                          acousticness: float | None = None, instrumentalness: float | None = None,
                          loudness: float | None = None, dynamic_range: float | None = None,
                          spectral_complexity: float | None = None):
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_tracks SET bpm=%s, audio_key=%s, audio_scale=%s, energy=%s, mood_json=%s, "
            "danceability=%s, valence=%s, acousticness=%s, instrumentalness=%s, "
            "loudness=%s, dynamic_range=%s, spectral_complexity=%s "
            "WHERE path=%s",
            (bpm, key, scale, energy, json.dumps(mood) if mood else None,
             danceability, valence, acousticness, instrumentalness,
             loudness, dynamic_range, spectral_complexity, path),
        )


def update_artist_enrichment(name: str, data: dict):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute("""
            UPDATE library_artists SET
                bio = %s, tags_json = %s, similar_json = %s,
                spotify_id = %s, spotify_popularity = %s,
                mbid = %s, country = %s, area = %s,
                formed = %s, ended = %s, artist_type = %s,
                members_json = %s, urls_json = %s,
                listeners = %s, enriched_at = %s
            WHERE name = %s
        """, (
            data.get("bio"), json.dumps(data.get("tags", [])),
            json.dumps(data.get("similar", [])),
            data.get("spotify_id"), data.get("spotify_popularity"),
            data.get("mbid"), data.get("country"), data.get("area"),
            data.get("formed"), data.get("ended"), data.get("artist_type"),
            json.dumps(data.get("members", [])),
            json.dumps(data.get("urls", {})),
            data.get("listeners"), now, name,
        ))


def delete_artist(name: str):
    with get_db_ctx() as cur:
        cur.execute("SELECT id FROM library_albums WHERE artist = %s", (name,))
        album_ids = [r["id"] for r in cur.fetchall()]
        for aid in album_ids:
            cur.execute("DELETE FROM library_tracks WHERE album_id = %s", (aid,))
        cur.execute("DELETE FROM library_albums WHERE artist = %s", (name,))
        cur.execute("DELETE FROM library_artists WHERE name = %s", (name,))


def delete_album(path: str):
    with get_db_ctx() as cur:
        cur.execute("SELECT id FROM library_albums WHERE path = %s", (path,))
        row = cur.fetchone()
        if row:
            cur.execute("DELETE FROM library_tracks WHERE album_id = %s", (row["id"],))
            cur.execute("DELETE FROM library_albums WHERE path = %s", (path,))


def delete_track(path: str):
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM library_tracks WHERE path = %s", (path,))


# ── Users ─────────────────────────────────────────────────────────

def _seed_admin(cur):
    cur.execute("SELECT COUNT(*) AS cnt FROM users")
    if cur.fetchone()["cnt"] == 0:
        from musicdock.auth import hash_password
        now = datetime.now(timezone.utc).isoformat()
        password = os.environ.get("DEFAULT_ADMIN_PASSWORD", "admin123")
        cur.execute(
            "INSERT INTO users (email, username, name, password_hash, role, created_at) VALUES (%s, %s, %s, %s, %s, %s)",
            ("yosoy@diego.ninja", "admin", "Diego", hash_password(password), "admin", now),
        )
    else:
        # Ensure admin has username set
        cur.execute("UPDATE users SET username = 'admin' WHERE email = 'yosoy@diego.ninja' AND (username IS NULL OR username = '')")


def create_user(email: str, name: str | None = None, password_hash: str | None = None,
                avatar: str | None = None, role: str = "user", google_id: str | None = None) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            """INSERT INTO users (email, name, password_hash, avatar, role, google_id, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *""",
            (email, name, password_hash, avatar, role, google_id, now),
        )
        return dict(cur.fetchone())


def get_user_by_email(email: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM users WHERE email = %s", (email,))
        row = cur.fetchone()
    return dict(row) if row else None


def get_user_by_google_id(google_id: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM users WHERE google_id = %s", (google_id,))
        row = cur.fetchone()
    return dict(row) if row else None


def get_user_by_id(user_id: int) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
    return dict(row) if row else None


def update_user_last_login(user_id: int):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute("UPDATE users SET last_login = %s WHERE id = %s", (now, user_id))


def list_users() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("SELECT id, email, name, avatar, role, google_id, created_at, last_login FROM users ORDER BY id")
        rows = cur.fetchall()
    return [dict(r) for r in rows]


def delete_user(user_id: int):
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM users WHERE id = %s", (user_id,))


# ── Sessions ─────────────────────────────────────────────────────

def create_session(session_id: str, user_id: int, expires_at: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (%s, %s, %s, %s) RETURNING *",
            (session_id, user_id, expires_at, now),
        )
        return dict(cur.fetchone())


def get_session(session_id: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM sessions WHERE id = %s", (session_id,))
        row = cur.fetchone()
    return dict(row) if row else None


def delete_session(session_id: str):
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM sessions WHERE id = %s", (session_id,))


# ── Library helpers ──────────────────────────────────────────────

def _row_to_lib_artist(row: dict) -> dict:
    d = dict(row)
    fmt = d.pop("formats_json", [])
    d["formats"] = fmt if isinstance(fmt, list) else json.loads(fmt or "[]")
    return d


def _row_to_lib_album(row: dict) -> dict:
    d = dict(row)
    fmt = d.pop("formats_json", [])
    d["formats"] = fmt if isinstance(fmt, list) else json.loads(fmt or "[]")
    return d


# ── Genres ────────────────────────────────────────────────────────

def _slugify(name: str) -> str:
    import re
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s-]+", "-", slug)
    return slug


def get_or_create_genre(name: str) -> int:
    name = name.strip()
    slug = _slugify(name)
    if not slug:
        return -1
    with get_db_ctx() as cur:
        cur.execute("SELECT id FROM genres WHERE slug = %s", (slug,))
        row = cur.fetchone()
        if row:
            return row["id"]
        cur.execute(
            "INSERT INTO genres (name, slug) VALUES (%s, %s) ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name RETURNING id",
            (name, slug),
        )
        return cur.fetchone()["id"]


def set_artist_genres(artist_name: str, genres: list[tuple[str, float, str]]):
    """Set genres for an artist. genres: [(name, weight, source), ...]"""
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM artist_genres WHERE artist_name = %s", (artist_name,))
        for name, weight, source in genres:
            genre_id = get_or_create_genre(name)
            if genre_id < 0:
                continue
            cur.execute(
                "INSERT INTO artist_genres (artist_name, genre_id, weight, source) VALUES (%s, %s, %s, %s) "
                "ON CONFLICT DO NOTHING",
                (artist_name, genre_id, weight, source),
            )


def set_album_genres(album_id: int, genres: list[tuple[str, float, str]]):
    """Set genres for an album. genres: [(name, weight, source), ...]"""
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM album_genres WHERE album_id = %s", (album_id,))
        for name, weight, source in genres:
            genre_id = get_or_create_genre(name)
            if genre_id < 0:
                continue
            cur.execute(
                "INSERT INTO album_genres (album_id, genre_id, weight, source) VALUES (%s, %s, %s, %s) "
                "ON CONFLICT DO NOTHING",
                (album_id, genre_id, weight, source),
            )


def get_all_genres() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT g.id, g.name, g.slug,
                   COUNT(DISTINCT ag.artist_name) AS artist_count,
                   COUNT(DISTINCT alg.album_id) AS album_count
            FROM genres g
            LEFT JOIN artist_genres ag ON g.id = ag.genre_id
            LEFT JOIN album_genres alg ON g.id = alg.genre_id
            GROUP BY g.id, g.name, g.slug
            HAVING COUNT(DISTINCT ag.artist_name) > 0 OR COUNT(DISTINCT alg.album_id) > 0
            ORDER BY COUNT(DISTINCT ag.artist_name) DESC
        """)
        return [dict(r) for r in cur.fetchall()]


def get_genre_detail(slug: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM genres WHERE slug = %s", (slug,))
        row = cur.fetchone()
        if not row:
            return None
        genre = dict(row)

        # Top artists by weight
        cur.execute("""
            SELECT ag.artist_name, ag.weight, ag.source,
                   la.album_count, la.track_count, la.has_photo, la.spotify_popularity, la.listeners
            FROM artist_genres ag
            JOIN library_artists la ON ag.artist_name = la.name
            WHERE ag.genre_id = %s
            ORDER BY ag.weight DESC, la.listeners DESC NULLS LAST
        """, (genre["id"],))
        genre["artists"] = [dict(r) for r in cur.fetchall()]

        # Albums in this genre
        cur.execute("""
            SELECT alg.album_id, alg.weight, a.artist, a.name, a.year, a.track_count, a.has_cover
            FROM album_genres alg
            JOIN library_albums a ON alg.album_id = a.id
            WHERE alg.genre_id = %s
            ORDER BY a.year DESC NULLS LAST
        """, (genre["id"],))
        genre["albums"] = [dict(r) for r in cur.fetchall()]

        return genre


# ── Playlists ────────────────────────────────────────────────────

def create_playlist(name: str, description: str = "", user_id: int | None = None,
                    is_smart: bool = False, smart_rules: dict | None = None) -> int:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO playlists (name, description, user_id, is_smart, smart_rules_json, created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (name, description, user_id, is_smart,
             json.dumps(smart_rules) if smart_rules else None, now, now),
        )
        return cur.fetchone()["id"]


def get_playlists(user_id: int | None = None) -> list[dict]:
    with get_db_ctx() as cur:
        if user_id:
            cur.execute("SELECT * FROM playlists WHERE user_id = %s ORDER BY updated_at DESC", (user_id,))
        else:
            cur.execute("SELECT * FROM playlists ORDER BY updated_at DESC")
        rows = cur.fetchall()
    results = []
    for r in rows:
        d = dict(r)
        rules = d.pop("smart_rules_json", None)
        d["smart_rules"] = rules if isinstance(rules, dict) else (json.loads(rules) if rules else None)
        results.append(d)
    return results


def get_playlist(playlist_id: int) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM playlists WHERE id = %s", (playlist_id,))
        row = cur.fetchone()
    if not row:
        return None
    d = dict(row)
    rules = d.pop("smart_rules_json", None)
    d["smart_rules"] = rules if isinstance(rules, dict) else (json.loads(rules) if rules else None)
    return d


def update_playlist(playlist_id: int, **kwargs):
    now = datetime.now(timezone.utc).isoformat()
    fields = ["updated_at = %s"]
    values: list = [now]
    for key in ("name", "description"):
        if key in kwargs:
            fields.append(f"{key} = %s")
            values.append(kwargs[key])
    if "smart_rules" in kwargs:
        fields.append("smart_rules_json = %s")
        values.append(json.dumps(kwargs["smart_rules"]))
    values.append(playlist_id)
    with get_db_ctx() as cur:
        cur.execute(f"UPDATE playlists SET {', '.join(fields)} WHERE id = %s", values)


def delete_playlist(playlist_id: int):
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM playlists WHERE id = %s", (playlist_id,))


def get_playlist_tracks(playlist_id: int) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM playlist_tracks WHERE playlist_id = %s ORDER BY position",
            (playlist_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def add_playlist_tracks(playlist_id: int, tracks: list[dict]):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        # Get current max position
        cur.execute("SELECT COALESCE(MAX(position), 0) AS maxp FROM playlist_tracks WHERE playlist_id = %s", (playlist_id,))
        pos = cur.fetchone()["maxp"]
        for t in tracks:
            pos += 1
            cur.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_path, title, artist, album, duration, position, added_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                (playlist_id, t["path"], t.get("title", ""), t.get("artist", ""),
                 t.get("album", ""), t.get("duration", 0), pos, now),
            )
        # Update counts
        cur.execute(
            "UPDATE playlists SET track_count = (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = %s), "
            "total_duration = (SELECT COALESCE(SUM(duration), 0) FROM playlist_tracks WHERE playlist_id = %s), "
            "updated_at = %s WHERE id = %s",
            (playlist_id, playlist_id, now, playlist_id),
        )


def remove_playlist_track(playlist_id: int, position: int):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM playlist_tracks WHERE playlist_id = %s AND position = %s", (playlist_id, position))
        # Reorder remaining
        cur.execute(
            "WITH ordered AS (SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS new_pos "
            "FROM playlist_tracks WHERE playlist_id = %s) "
            "UPDATE playlist_tracks SET position = ordered.new_pos "
            "FROM ordered WHERE playlist_tracks.id = ordered.id",
            (playlist_id,),
        )
        cur.execute(
            "UPDATE playlists SET track_count = (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = %s), "
            "total_duration = (SELECT COALESCE(SUM(duration), 0) FROM playlist_tracks WHERE playlist_id = %s), "
            "updated_at = %s WHERE id = %s",
            (playlist_id, playlist_id, now, playlist_id),
        )


def reorder_playlist(playlist_id: int, track_ids: list[int]):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        for pos, tid in enumerate(track_ids, 1):
            cur.execute("UPDATE playlist_tracks SET position = %s WHERE id = %s AND playlist_id = %s",
                        (pos, tid, playlist_id))
        cur.execute("UPDATE playlists SET updated_at = %s WHERE id = %s", (now, playlist_id))


# ── Audit log ────────────────────────────────────────────────────

def log_audit(action: str, target_type: str, target_name: str,
              details: dict | None = None, user_id: int | None = None,
              task_id: str | None = None):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO audit_log (timestamp, action, target_type, target_name, details_json, user_id, task_id) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (now, action, target_type, target_name,
             json.dumps(details) if details else "{}", user_id, task_id),
        )


def get_audit_log(limit: int = 100, offset: int = 0,
                  action: str | None = None) -> tuple[list[dict], int]:
    where = "WHERE 1=1"
    params: list = []
    if action:
        where += " AND action = %s"
        params.append(action)

    with get_db_ctx() as cur:
        cur.execute(f"SELECT COUNT(*) AS cnt FROM audit_log {where}", params)
        total = cur.fetchone()["cnt"]
        cur.execute(
            f"SELECT * FROM audit_log {where} ORDER BY timestamp DESC LIMIT %s OFFSET %s",
            params + [limit, offset],
        )
        rows = cur.fetchall()

    results = []
    for row in rows:
        d = dict(row)
        det = d.pop("details_json", {})
        d["details"] = det if isinstance(det, dict) else json.loads(det or "{}")
        results.append(d)
    return results, total


# ── Library management ───────────────────────────────────────────

def wipe_library_tables():
    with get_db_ctx() as cur:
        cur.execute("TRUNCATE library_tracks, library_albums, library_artists CASCADE")


def get_db_table_stats() -> dict:
    tables = [
        "library_artists", "library_albums", "library_tracks",
        "tasks", "cache", "mb_cache", "settings", "audit_log",
        "scan_results", "dir_mtimes", "users", "sessions",
    ]
    stats = {}
    with get_db_ctx() as cur:
        for table in tables:
            try:
                cur.execute(
                    "SELECT pg_total_relation_size(%s) AS size, "
                    "(SELECT COUNT(*) FROM {} ) AS cnt".format(table),
                    (table,),
                )
                row = cur.fetchone()
                stats[table] = {"size": row["size"], "rows": row["cnt"]}
            except Exception:
                stats[table] = {"size": 0, "rows": 0}
    return stats
