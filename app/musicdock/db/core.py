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
            CREATE TABLE IF NOT EXISTS health_issues (
                id SERIAL PRIMARY KEY,
                check_type TEXT NOT NULL,
                severity TEXT NOT NULL DEFAULT 'medium',
                description TEXT NOT NULL,
                details_json JSONB DEFAULT '{}',
                auto_fixable BOOLEAN DEFAULT FALSE,
                status TEXT NOT NULL DEFAULT 'open',
                created_at TEXT NOT NULL,
                resolved_at TEXT
            )
        """)
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_health_issues_dedup
            ON health_issues (check_type, md5(description)) WHERE status = 'open'
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS task_events (
                id SERIAL PRIMARY KEY,
                task_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                data_json JSONB DEFAULT '{}',
                created_at TEXT NOT NULL
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, id)")
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

        from musicdock.db.auth import _seed_admin
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
            ("discogs_id", "TEXT"), ("spotify_followers", "INTEGER"),
            ("lastfm_playcount", "INTEGER"),
            ("discogs_profile", "TEXT"), ("discogs_members_json", "JSONB"),
        ]:
            cur.execute(f"""
                DO $$ BEGIN
                    ALTER TABLE library_artists ADD COLUMN {col} {col_type};
                EXCEPTION WHEN duplicate_column THEN NULL;
                END $$
            """)

        # Migration: bliss feature vector for song distance/similarity
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE library_tracks ADD COLUMN bliss_vector DOUBLE PRECISION[];
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)

        # Migration: popularity columns
        for table, cols in [
            ("library_artists", [("lastfm_playcount", "BIGINT"), ("spotify_followers", "INTEGER")]),
            ("library_albums", [("lastfm_listeners", "INTEGER"), ("lastfm_playcount", "BIGINT"), ("popularity", "INTEGER")]),
            ("library_tracks", [("lastfm_listeners", "INTEGER"), ("lastfm_playcount", "BIGINT"), ("popularity", "INTEGER")]),
        ]:
            for col, col_type in cols:
                cur.execute(f"""
                    DO $$ BEGIN
                        ALTER TABLE {table} ADD COLUMN {col} {col_type};
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

        # Migration: discogs_master_id for album-level Discogs linking
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE library_albums ADD COLUMN discogs_master_id TEXT;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)

        # Migration: add FK on task_events → tasks (cascade delete)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE task_events ADD CONSTRAINT fk_task_events_task
                    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
            EXCEPTION WHEN duplicate_object THEN NULL;
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

        # Tidal downloads
        cur.execute("""
            CREATE TABLE IF NOT EXISTS tidal_downloads (
                id SERIAL PRIMARY KEY,
                tidal_url TEXT NOT NULL,
                tidal_id TEXT NOT NULL,
                content_type TEXT NOT NULL,
                title TEXT NOT NULL,
                artist TEXT,
                cover_url TEXT,
                quality TEXT DEFAULT 'max',
                status TEXT DEFAULT 'wishlist',
                priority INTEGER DEFAULT 0,
                source TEXT,
                task_id TEXT,
                error TEXT,
                metadata_json JSONB DEFAULT '{}',
                created_at TEXT NOT NULL,
                completed_at TEXT
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_tidal_downloads_status ON tidal_downloads(status)")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS tidal_monitored_artists (
                artist_name TEXT PRIMARY KEY,
                tidal_id TEXT,
                last_checked TEXT,
                last_release_id TEXT,
                enabled BOOLEAN DEFAULT TRUE
            )
        """)

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

        # Migration: Navidrome IDs
        for table, cols in [
            ("library_tracks", [("navidrome_id", "TEXT")]),
            ("library_albums", [("navidrome_id", "TEXT")]),
            ("library_artists", [("navidrome_id", "TEXT")]),
        ]:
            for col, col_type in cols:
                cur.execute(f"""
                    DO $$ BEGIN
                        ALTER TABLE {table} ADD COLUMN {col} {col_type};
                    EXCEPTION WHEN duplicate_column THEN NULL;
                    END $$
                """)

        # Migration: favorites table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS favorites (
                id SERIAL PRIMARY KEY,
                item_type TEXT NOT NULL,
                item_id TEXT NOT NULL,
                navidrome_id TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(item_type, item_id)
            )
        """)


