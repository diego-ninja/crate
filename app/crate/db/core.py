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


def _reset_pool():
    """Reset the connection pool. Must be called after fork() in child processes.
    Does NOT close connections — they belong to the parent process."""
    global _pool
    _pool = None


def _get_dsn() -> str:
    user = os.environ.get("CRATE_POSTGRES_USER", "crate")
    password = os.environ.get("CRATE_POSTGRES_PASSWORD", "crate")
    host = os.environ.get("CRATE_POSTGRES_HOST", "crate-postgres")
    port = os.environ.get("CRATE_POSTGRES_PORT", "5432")
    db = os.environ.get("CRATE_POSTGRES_DB", "crate")
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
            CREATE TABLE IF NOT EXISTS new_releases (
                id SERIAL PRIMARY KEY,
                artist_name TEXT NOT NULL,
                album_title TEXT NOT NULL,
                tidal_id TEXT,
                tidal_url TEXT,
                cover_url TEXT,
                year TEXT,
                tracks INTEGER,
                quality TEXT,
                status TEXT NOT NULL DEFAULT 'detected',
                detected_at TEXT NOT NULL,
                downloaded_at TEXT,
                UNIQUE(artist_name, album_title)
            )
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
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_external_identities (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                provider TEXT NOT NULL,
                external_user_id TEXT,
                external_username TEXT,
                status TEXT NOT NULL DEFAULT 'unlinked',
                last_error TEXT,
                last_task_id TEXT,
                metadata_json JSONB DEFAULT '{}',
                last_synced_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE (user_id, provider)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_user_external_identities_provider ON user_external_identities(provider)")
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_external_identities_provider_username ON user_external_identities(provider, external_username) WHERE external_username IS NOT NULL")

        # Migration: add username column if missing
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE users ADD COLUMN username TEXT UNIQUE;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)

        from crate.db.auth import _seed_admin
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
            ("latest_release_date", "TEXT"),
            ("content_hash", "TEXT"),
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

        # Migration: musicbrainz_releasegroupid for album-level MB linking
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE library_albums ADD COLUMN musicbrainz_releasegroupid TEXT;
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

        # Performance indexes
        cur.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        for idx_sql in [
            "CREATE INDEX IF NOT EXISTS idx_artists_name_trgm ON library_artists USING gin(name gin_trgm_ops)",
            "CREATE INDEX IF NOT EXISTS idx_albums_name_trgm ON library_albums USING gin(name gin_trgm_ops)",
            "CREATE INDEX IF NOT EXISTS idx_tracks_title_trgm ON library_tracks USING gin(title gin_trgm_ops)",
            "CREATE INDEX IF NOT EXISTS idx_albums_artist_name ON library_albums(artist, name)",
            "CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON library_tracks(album_id)",
            "CREATE INDEX IF NOT EXISTS idx_tracks_bpm ON library_tracks(bpm) WHERE bpm IS NOT NULL",
            "CREATE INDEX IF NOT EXISTS idx_tracks_energy ON library_tracks(energy) WHERE energy IS NOT NULL",
        ]:
            try:
                cur.execute(idx_sql)
            except Exception:
                pass

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
                cover_data_url TEXT,
                cover_path TEXT,
                user_id INTEGER REFERENCES users(id),
                is_smart BOOLEAN DEFAULT FALSE,
                smart_rules_json JSONB,
                scope TEXT NOT NULL DEFAULT 'user',
                generation_mode TEXT NOT NULL DEFAULT 'static',
                is_curated BOOLEAN NOT NULL DEFAULT FALSE,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                managed_by_user_id INTEGER REFERENCES users(id),
                curation_key TEXT,
                featured_rank INTEGER,
                category TEXT,
                navidrome_playlist_id TEXT,
                navidrome_public BOOLEAN NOT NULL DEFAULT FALSE,
                navidrome_projection_status TEXT NOT NULL DEFAULT 'unprojected',
                navidrome_projection_error TEXT,
                navidrome_projected_at TEXT,
                track_count INTEGER DEFAULT 0,
                total_duration DOUBLE PRECISION DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE playlists ADD COLUMN cover_data_url TEXT;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE playlists ADD COLUMN cover_path TEXT;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)
        for col, col_type, default in [
            ("scope", "TEXT", "'user'"),
            ("generation_mode", "TEXT", "'static'"),
            ("is_curated", "BOOLEAN", "FALSE"),
            ("is_active", "BOOLEAN", "TRUE"),
            ("managed_by_user_id", "INTEGER REFERENCES users(id)", None),
            ("curation_key", "TEXT", None),
            ("featured_rank", "INTEGER", None),
            ("category", "TEXT", None),
            ("navidrome_playlist_id", "TEXT", None),
            ("navidrome_public", "BOOLEAN", "FALSE"),
            ("navidrome_projection_status", "TEXT", "'unprojected'"),
            ("navidrome_projection_error", "TEXT", None),
            ("navidrome_projected_at", "TEXT", None),
        ]:
            default_clause = f" DEFAULT {default}" if default is not None else ""
            cur.execute(f"""
                DO $$ BEGIN
                    ALTER TABLE playlists ADD COLUMN {col} {col_type}{default_clause};
                EXCEPTION WHEN duplicate_column THEN NULL;
                END $$
            """)
        cur.execute("""
            UPDATE playlists
            SET scope = CASE WHEN user_id IS NULL THEN 'system' ELSE 'user' END
            WHERE scope IS NULL OR scope = ''
        """)
        cur.execute("""
            UPDATE playlists
            SET generation_mode = CASE WHEN is_smart THEN 'smart' ELSE 'static' END
            WHERE generation_mode IS NULL OR generation_mode = ''
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_playlists_scope_active
            ON playlists(scope, is_active, updated_at DESC)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_playlists_curated
            ON playlists(is_curated, category, featured_rank)
        """)
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_curation_key
            ON playlists(curation_key) WHERE curation_key IS NOT NULL
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
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_followed_playlists (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                followed_at TEXT NOT NULL,
                PRIMARY KEY (user_id, playlist_id)
            )
        """)
        cur.execute("""
            DO $$
            DECLARE
                target_table text;
            BEGIN
                SELECT ccu.table_name
                INTO target_table
                FROM information_schema.table_constraints tc
                JOIN information_schema.constraint_column_usage ccu
                  ON tc.constraint_name = ccu.constraint_name
                 AND tc.table_schema = ccu.table_schema
                WHERE tc.table_name = 'user_followed_playlists'
                  AND tc.constraint_name = 'user_followed_playlists_playlist_id_fkey'
                LIMIT 1;

                IF target_table IS DISTINCT FROM 'playlists' THEN
                    BEGIN
                        ALTER TABLE user_followed_playlists
                        DROP CONSTRAINT IF EXISTS user_followed_playlists_playlist_id_fkey;
                    EXCEPTION WHEN undefined_table THEN
                        NULL;
                    END;

                    ALTER TABLE user_followed_playlists
                    ADD CONSTRAINT user_followed_playlists_playlist_id_fkey
                    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE;
                END IF;
            END $$;
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_user_followed_playlists_user ON user_followed_playlists(user_id, followed_at DESC)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_user_followed_playlists_playlist ON user_followed_playlists(playlist_id)")

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

        # Shows (persistent concert/event storage)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS shows (
                id SERIAL PRIMARY KEY,
                external_id TEXT UNIQUE,
                artist_name TEXT NOT NULL,
                date TEXT NOT NULL,
                local_time TEXT,
                venue TEXT,
                city TEXT,
                region TEXT,
                country TEXT,
                country_code TEXT,
                latitude DOUBLE PRECISION,
                longitude DOUBLE PRECISION,
                url TEXT,
                image_url TEXT,
                lineup TEXT[],
                price_range TEXT,
                status TEXT DEFAULT 'onsale',
                source TEXT DEFAULT 'ticketmaster',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_shows_date ON shows(date)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_shows_artist ON shows(artist_name)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_shows_city ON shows(city)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_show_attendance (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                UNIQUE(user_id, show_id)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_user_show_attendance_user ON user_show_attendance(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_user_show_attendance_show ON user_show_attendance(show_id)")

        # Migration: track rating (0-5 stars)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE library_tracks ADD COLUMN rating INTEGER DEFAULT 0;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)

        # Artist similarities table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS artist_similarities (
                id SERIAL PRIMARY KEY,
                artist_name TEXT NOT NULL,
                similar_name TEXT NOT NULL,
                score REAL DEFAULT 0,
                source TEXT DEFAULT 'lastfm',
                in_library BOOLEAN DEFAULT FALSE,
                updated_at TEXT NOT NULL,
                UNIQUE(artist_name, similar_name)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_similarities_artist ON artist_similarities(artist_name)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_similarities_similar ON artist_similarities(similar_name)")

        # Migration: Dramatiq worker system — priority, pool, heartbeat, parent tasks
        for col, col_type, default in [
            ("priority", "INTEGER", "2"),
            ("pool", "TEXT", "'default'"),
            ("parent_task_id", "TEXT", None),
            ("max_duration_sec", "INTEGER", "1800"),
            ("heartbeat_at", "TEXT", None),
            ("worker_id", "TEXT", None),
            ("retry_count", "INTEGER", "0"),
            ("max_retries", "INTEGER", "0"),
            ("started_at", "TEXT", None),
        ]:
            default_clause = f" DEFAULT {default}" if default else ""
            cur.execute(f"""
                DO $$ BEGIN
                    ALTER TABLE tasks ADD COLUMN {col} {col_type}{default_clause};
                EXCEPTION WHEN duplicate_column THEN NULL;
                END $$
            """)

        # Index for efficient claim/dispatch queries (pending tasks by pool+priority)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_tasks_dispatch
            ON tasks (pool, priority, created_at) WHERE status = 'pending'
        """)
        # Index for parent task lookups (sub-task coordination)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_tasks_parent
            ON tasks (parent_task_id) WHERE parent_task_id IS NOT NULL
        """)
        # Index for heartbeat monitoring (zombie detection)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_tasks_heartbeat
            ON tasks (heartbeat_at) WHERE status = 'running'
        """)

        # Migration: add release_date, release_type, mb_release_group_id to new_releases
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE new_releases ADD COLUMN release_date TEXT;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE new_releases ADD COLUMN release_type TEXT DEFAULT 'Album';
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE new_releases ADD COLUMN mb_release_group_id TEXT;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)

        # User personal library tables
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_follows (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                artist_name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, artist_name)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_user_follows_user ON user_follows(user_id)")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_saved_albums (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                album_id INTEGER NOT NULL REFERENCES library_albums(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, album_id)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_user_saved_albums_user ON user_saved_albums(user_id)")

        cur.execute("""
            DO $$ BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name = 'user_liked_tracks' AND column_name = 'track_path'
                ) THEN
                    DROP TABLE user_liked_tracks;
                END IF;
            END $$
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_liked_tracks (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                track_id INTEGER NOT NULL REFERENCES library_tracks(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, track_id)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_user_liked_tracks_user ON user_liked_tracks(user_id)")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS play_history (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                track_id INTEGER REFERENCES library_tracks(id) ON DELETE SET NULL,
                track_path TEXT NOT NULL,
                title TEXT,
                artist TEXT,
                album TEXT,
                played_at TEXT NOT NULL
            )
        """)
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE play_history ADD COLUMN track_id INTEGER REFERENCES library_tracks(id) ON DELETE SET NULL;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_play_history_user ON play_history(user_id, played_at DESC)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_play_history_track ON play_history(track_id)")

        # Migration: add user_id to favorites table if missing
        cur.execute("""
            DO $$ BEGIN
                ALTER TABLE favorites ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)
