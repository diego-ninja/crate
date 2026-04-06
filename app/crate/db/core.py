import logging
import json
import os
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
import psycopg2.pool
from psycopg2 import sql

from crate.slugs import build_album_slug, build_artist_slug, build_track_slug

log = logging.getLogger(__name__)

_pool: psycopg2.pool.ThreadedConnectionPool | None = None
_db_provisioned = False


def _reserve_unique_slug(existing: set[str], base_slug: str) -> str:
    base = base_slug or "item"
    candidate = base
    suffix = 2
    while candidate in existing:
        candidate = f"{base}-{suffix}"
        suffix += 1
    existing.add(candidate)
    return candidate


def _backfill_missing_slugs(cur) -> None:
    for table in ("library_artists", "library_albums", "library_tracks"):
        cur.execute(sql.SQL("SELECT slug FROM {} WHERE slug IS NOT NULL AND slug != ''").format(sql.Identifier(table)))
        existing = {row["slug"] for row in cur.fetchall()}

        if table == "library_artists":
            cur.execute("SELECT name FROM library_artists WHERE slug IS NULL OR slug = '' ORDER BY name")
            for row in cur.fetchall():
                slug = _reserve_unique_slug(existing, build_artist_slug(row["name"]))
                cur.execute("UPDATE library_artists SET slug = %s WHERE name = %s", (slug, row["name"]))
            continue

        if table == "library_albums":
            cur.execute("SELECT id, artist, name FROM library_albums WHERE slug IS NULL OR slug = '' ORDER BY id")
            for row in cur.fetchall():
                slug = _reserve_unique_slug(existing, build_album_slug(row["artist"], row["name"]))
                cur.execute("UPDATE library_albums SET slug = %s WHERE id = %s", (slug, row["id"]))
            continue

        cur.execute(
            """
            SELECT id, artist, title, filename
            FROM library_tracks
            WHERE slug IS NULL OR slug = ''
            ORDER BY id
            """
        )
        for row in cur.fetchall():
            slug = _reserve_unique_slug(
                existing,
                build_track_slug(row["artist"], row.get("title"), row.get("filename")),
            )
            cur.execute("UPDATE library_tracks SET slug = %s WHERE id = %s", (slug, row["id"]))


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


def _ensure_database():
    """Create the app user and database if they don't exist.
    Connects as the Postgres superuser (MUSICDOCK_POSTGRES_*) to provision
    the app-level role (CRATE_POSTGRES_*). Idempotent and safe to call on
    every startup. Skips silently if superuser creds are not available."""
    global _db_provisioned
    if _db_provisioned:
        return
    _db_provisioned = True

    su_user = os.environ.get("MUSICDOCK_POSTGRES_USER")
    su_pass = os.environ.get("MUSICDOCK_POSTGRES_PASSWORD")
    if not su_user:
        return  # No superuser creds — assume app user already exists

    app_user = os.environ.get("CRATE_POSTGRES_USER", "crate")
    app_pass = os.environ.get("CRATE_POSTGRES_PASSWORD", "crate")
    app_db = os.environ.get("CRATE_POSTGRES_DB", "crate")
    host = os.environ.get("CRATE_POSTGRES_HOST", "crate-postgres")
    port = os.environ.get("CRATE_POSTGRES_PORT", "5432")

    if su_user == app_user:
        return  # Same user, nothing to provision

    try:
        conn = psycopg2.connect(
            host=host, port=port, user=su_user, password=su_pass,
            dbname=os.environ.get("MUSICDOCK_POSTGRES_DB", "musicdock"),
        )
        conn.autocommit = True
        cur = conn.cursor()

        # Create app role if missing
        cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (app_user,))
        if not cur.fetchone():
            cur.execute(
                sql.SQL("CREATE ROLE {} WITH LOGIN PASSWORD %s").format(sql.Identifier(app_user)),
                (app_pass,),
            )
            log.info("Created database role: %s", app_user)

        # Create app database if missing
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (app_db,))
        if not cur.fetchone():
            cur.execute(
                sql.SQL("CREATE DATABASE {} OWNER {}").format(
                    sql.Identifier(app_db),
                    sql.Identifier(app_user),
                )
            )
            log.info("Created database: %s", app_db)

        # Ensure ownership
        cur.execute(
            sql.SQL("ALTER DATABASE {} OWNER TO {}").format(
                sql.Identifier(app_db),
                sql.Identifier(app_user),
            )
        )

        cur.close()
        conn.close()
    except Exception:
        log.debug("Could not provision app database (superuser may not be available)", exc_info=True)


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None or _pool.closed:
        _ensure_database()
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


_MIGRATION_LOCK_ID = 820149  # arbitrary unique advisory lock ID for init_db


def init_db():
    # Acquire an advisory lock so only one process (API or worker) runs
    # schema migrations at a time.  The lock is automatically released
    # when the connection is returned to the pool.
    pool = _get_pool()
    lock_conn = pool.getconn()
    try:
        lock_conn.autocommit = True
        with lock_conn.cursor() as lc:
            lc.execute("SELECT pg_advisory_lock(%s)", (_MIGRATION_LOCK_ID,))
        _init_db_inner()
    finally:
        try:
            lock_conn.autocommit = True
            with lock_conn.cursor() as lc:
                lc.execute("SELECT pg_advisory_unlock(%s)", (_MIGRATION_LOCK_ID,))
        except Exception:
            pass
        pool.putconn(lock_conn)


# ---------------------------------------------------------------------------
# Schema + Migrations
# ---------------------------------------------------------------------------

def _init_db_inner():
    with get_db_ctx() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS schema_versions (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        _create_schema(cur)
        _run_migrations(cur)
        from crate.db.auth import _seed_admin
        _seed_admin(cur)


def _create_schema(cur):
    """Idempotent schema creation — defines the FINAL shape of every table.
    New installs get all columns from the start. Existing installs that already
    have the tables will get missing columns added via _run_migrations."""

    cur.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    cur.execute("CREATE SEQUENCE IF NOT EXISTS library_artists_id_seq")

    # ── Core tables ───────────────────────────────────────────────

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
            updated_at TEXT NOT NULL,
            priority INTEGER DEFAULT 2,
            pool TEXT DEFAULT 'default',
            parent_task_id TEXT,
            max_duration_sec INTEGER DEFAULT 1800,
            heartbeat_at TEXT,
            worker_id TEXT,
            retry_count INTEGER DEFAULT 0,
            max_retries INTEGER DEFAULT 0,
            started_at TEXT
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at)")
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_tasks_dispatch
        ON tasks (pool, priority, created_at) WHERE status = 'pending'
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_tasks_parent
        ON tasks (parent_task_id) WHERE parent_task_id IS NOT NULL
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_tasks_heartbeat
        ON tasks (heartbeat_at) WHERE status = 'running'
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
            release_date TEXT,
            release_type TEXT DEFAULT 'Album',
            mb_release_group_id TEXT,
            UNIQUE(artist_name, album_title)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS task_events (
            id SERIAL PRIMARY KEY,
            task_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            data_json JSONB DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
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
    cur.execute("CREATE INDEX IF NOT EXISTS idx_mb_cache_created ON mb_cache(created_at)")

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

    # ── Users & Auth ──────────────────────────────────────────────

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
    cur.execute("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)")

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
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_external_identities_provider ON user_external_identities(provider)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_external_identities_provider_username ON user_external_identities(provider, external_username) WHERE external_username IS NOT NULL")

    # ── Library ───────────────────────────────────────────────────

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
            updated_at TEXT,
            id BIGINT DEFAULT nextval('library_artists_id_seq'),
            slug TEXT,
            folder_name TEXT,
            bio TEXT,
            tags_json JSONB,
            similar_json JSONB,
            spotify_id TEXT,
            spotify_popularity INTEGER,
            mbid TEXT,
            country TEXT,
            area TEXT,
            formed TEXT,
            ended TEXT,
            artist_type TEXT,
            members_json JSONB,
            urls_json JSONB,
            listeners INTEGER,
            enriched_at TEXT,
            discogs_id TEXT,
            spotify_followers INTEGER,
            lastfm_playcount BIGINT,
            discogs_profile TEXT,
            discogs_members_json JSONB,
            latest_release_date TEXT,
            content_hash TEXT,
            navidrome_id TEXT
        )
    """)
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_artists_id ON library_artists(id)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_artists_slug ON library_artists(slug)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_artists_name_trgm ON library_artists USING gin(name gin_trgm_ops)")

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
            slug TEXT,
            tag_album TEXT,
            musicbrainz_releasegroupid TEXT,
            discogs_master_id TEXT,
            lastfm_listeners INTEGER,
            lastfm_playcount BIGINT,
            popularity INTEGER,
            navidrome_id TEXT,
            UNIQUE(artist, name)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_lib_albums_artist ON library_albums(artist)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_albums_slug ON library_albums(slug)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_albums_name_trgm ON library_albums USING gin(name gin_trgm_ops)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_albums_artist_name ON library_albums(artist, name)")

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
            mood_json JSONB,
            slug TEXT,
            danceability DOUBLE PRECISION,
            valence DOUBLE PRECISION,
            acousticness DOUBLE PRECISION,
            instrumentalness DOUBLE PRECISION,
            loudness DOUBLE PRECISION,
            dynamic_range DOUBLE PRECISION,
            spectral_complexity DOUBLE PRECISION,
            analysis_state TEXT DEFAULT 'pending',
            bliss_state TEXT DEFAULT 'pending',
            bliss_vector DOUBLE PRECISION[],
            lastfm_listeners INTEGER,
            lastfm_playcount BIGINT,
            popularity INTEGER,
            rating INTEGER DEFAULT 0,
            navidrome_id TEXT
        )
    """)
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_tracks_slug ON library_tracks(slug)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_lib_tracks_album ON library_tracks(album_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_lib_tracks_artist ON library_tracks(artist)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_lib_tracks_genre ON library_tracks(genre)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_lib_tracks_year ON library_tracks(year)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_tracks_analysis_pending ON library_tracks(updated_at DESC) WHERE analysis_state = 'pending'")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_tracks_bliss_pending ON library_tracks(updated_at DESC) WHERE bliss_state = 'pending'")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_tracks_title_trgm ON library_tracks USING gin(title gin_trgm_ops)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON library_tracks(album_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_tracks_bpm ON library_tracks(bpm) WHERE bpm IS NOT NULL")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_tracks_energy ON library_tracks(energy) WHERE energy IS NOT NULL")

    # ── Genres ────────────────────────────────────────────────────

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

    # ── Tidal ─────────────────────────────────────────────────────

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

    # ── Playlists ─────────────────────────────────────────────────

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
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_followed_playlists_user ON user_followed_playlists(user_id, followed_at DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_followed_playlists_playlist ON user_followed_playlists(playlist_id)")

    # ── Audit ─────────────────────────────────────────────────────

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

    # ── Favorites ─────────────────────────────────────────────────

    cur.execute("""
        CREATE TABLE IF NOT EXISTS favorites (
            id SERIAL PRIMARY KEY,
            item_type TEXT NOT NULL,
            item_id TEXT NOT NULL,
            navidrome_id TEXT,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            UNIQUE(item_type, item_id)
        )
    """)

    # ── Shows ─────────────────────────────────────────────────────

    cur.execute("""
        CREATE TABLE IF NOT EXISTS shows (
            id SERIAL PRIMARY KEY,
            external_id TEXT UNIQUE,
            artist_name TEXT NOT NULL,
            date TEXT NOT NULL,
            local_time TEXT,
            venue TEXT,
            address_line1 TEXT,
            city TEXT,
            region TEXT,
            postal_code TEXT,
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

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_show_reminders (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
            reminder_type TEXT NOT NULL,
            created_at TEXT NOT NULL,
            triggered_at TEXT,
            UNIQUE(user_id, show_id, reminder_type)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_show_reminders_user ON user_show_reminders(user_id, show_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_show_reminders_type ON user_show_reminders(user_id, reminder_type)")

    # ── Artist similarities ───────────────────────────────────────

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

    # ── User personal library ─────────────────────────────────────

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
        CREATE TABLE IF NOT EXISTS user_liked_tracks (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            track_id INTEGER NOT NULL REFERENCES library_tracks(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            PRIMARY KEY (user_id, track_id)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_liked_tracks_user ON user_liked_tracks(user_id)")

    # ── Play history & analytics ──────────────────────────────────

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
    cur.execute("CREATE INDEX IF NOT EXISTS idx_play_history_user ON play_history(user_id, played_at DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_play_history_track ON play_history(track_id)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_play_events (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            track_id INTEGER REFERENCES library_tracks(id) ON DELETE SET NULL,
            track_path TEXT,
            title TEXT,
            artist TEXT,
            album TEXT,
            started_at TEXT NOT NULL,
            ended_at TEXT NOT NULL,
            played_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
            track_duration_seconds DOUBLE PRECISION,
            completion_ratio DOUBLE PRECISION,
            was_skipped BOOLEAN NOT NULL DEFAULT FALSE,
            was_completed BOOLEAN NOT NULL DEFAULT FALSE,
            play_source_type TEXT,
            play_source_id TEXT,
            play_source_name TEXT,
            context_artist TEXT,
            context_album TEXT,
            context_playlist_id INTEGER,
            device_type TEXT,
            app_platform TEXT,
            created_at TEXT NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_play_events_user ON user_play_events(user_id, ended_at DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_play_events_track ON user_play_events(track_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_play_events_source ON user_play_events(user_id, play_source_type, ended_at DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_play_events_user_artist ON user_play_events(user_id, artist, ended_at DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_play_events_user_album ON user_play_events(user_id, album, ended_at DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_play_events_user_day ON user_play_events(user_id, (substring(ended_at, 1, 10)))")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_daily_listening (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            day TEXT NOT NULL,
            play_count INTEGER NOT NULL DEFAULT 0,
            complete_play_count INTEGER NOT NULL DEFAULT 0,
            skip_count INTEGER NOT NULL DEFAULT 0,
            minutes_listened DOUBLE PRECISION NOT NULL DEFAULT 0,
            unique_tracks INTEGER NOT NULL DEFAULT 0,
            unique_artists INTEGER NOT NULL DEFAULT 0,
            unique_albums INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, day)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_daily_listening_user ON user_daily_listening(user_id, day DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_track_stats (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            stat_window TEXT NOT NULL,
            entity_key TEXT NOT NULL,
            track_id INTEGER REFERENCES library_tracks(id) ON DELETE SET NULL,
            track_path TEXT,
            title TEXT,
            artist TEXT,
            album TEXT,
            play_count INTEGER NOT NULL DEFAULT 0,
            complete_play_count INTEGER NOT NULL DEFAULT 0,
            minutes_listened DOUBLE PRECISION NOT NULL DEFAULT 0,
            first_played_at TEXT,
            last_played_at TEXT,
            PRIMARY KEY (user_id, stat_window, entity_key)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_track_stats_lookup ON user_track_stats(user_id, stat_window, play_count DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_artist_stats (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            stat_window TEXT NOT NULL,
            artist_name TEXT NOT NULL,
            play_count INTEGER NOT NULL DEFAULT 0,
            complete_play_count INTEGER NOT NULL DEFAULT 0,
            minutes_listened DOUBLE PRECISION NOT NULL DEFAULT 0,
            first_played_at TEXT,
            last_played_at TEXT,
            PRIMARY KEY (user_id, stat_window, artist_name)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_artist_stats_lookup ON user_artist_stats(user_id, stat_window, play_count DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_album_stats (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            stat_window TEXT NOT NULL,
            entity_key TEXT NOT NULL,
            artist TEXT,
            album TEXT,
            play_count INTEGER NOT NULL DEFAULT 0,
            complete_play_count INTEGER NOT NULL DEFAULT 0,
            minutes_listened DOUBLE PRECISION NOT NULL DEFAULT 0,
            first_played_at TEXT,
            last_played_at TEXT,
            PRIMARY KEY (user_id, stat_window, entity_key)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_album_stats_lookup ON user_album_stats(user_id, stat_window, play_count DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_genre_stats (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            stat_window TEXT NOT NULL,
            genre_name TEXT NOT NULL,
            play_count INTEGER NOT NULL DEFAULT 0,
            complete_play_count INTEGER NOT NULL DEFAULT 0,
            minutes_listened DOUBLE PRECISION NOT NULL DEFAULT 0,
            first_played_at TEXT,
            last_played_at TEXT,
            PRIMARY KEY (user_id, stat_window, genre_name)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_genre_stats_lookup ON user_genre_stats(user_id, stat_window, play_count DESC)")


# ---------------------------------------------------------------------------
# Migration runner
# ---------------------------------------------------------------------------

def _run_migrations(cur):
    cur.execute("SELECT version FROM schema_versions")
    applied = {row["version"] for row in cur.fetchall()}

    if not applied:
        # First run with migration system on an existing database.
        # All migrations are idempotent (DO $$ ... EXCEPTION WHEN duplicate_column),
        # so we run them all — they'll no-op on columns that already exist —
        # then record them as applied so future startups skip them.
        log.info("Bootstrapping migration tracking for existing database")

    for version, name, fn in _MIGRATIONS:
        if version in applied:
            continue
        log.info("Applying migration %d: %s", version, name)
        fn(cur)
        cur.execute(
            "INSERT INTO schema_versions (version, name) VALUES (%s, %s)",
            (version, name),
        )


# ---------------------------------------------------------------------------
# Individual migrations (ALTER TABLE for existing installs)
# ---------------------------------------------------------------------------

def _m01_add_artist_id_sequence(cur):
    cur.execute("""
        DO $$ BEGIN
            ALTER TABLE library_artists ADD COLUMN id BIGINT;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    """)
    cur.execute("ALTER TABLE library_artists ALTER COLUMN id SET DEFAULT nextval('library_artists_id_seq')")
    cur.execute("UPDATE library_artists SET id = nextval('library_artists_id_seq') WHERE id IS NULL")
    cur.execute("""
        SELECT setval(
            'library_artists_id_seq',
            GREATEST(COALESCE((SELECT MAX(id) FROM library_artists), 0), 1),
            true
        )
    """)


def _m02_add_slug_columns(cur):
    for table in ("library_artists", "library_albums", "library_tracks"):
        cur.execute(f"""
            DO $$ BEGIN
                ALTER TABLE {table} ADD COLUMN slug TEXT;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)
    _backfill_missing_slugs(cur)


def _m03_add_audio_analysis_columns(cur):
    for col in ("danceability", "valence", "acousticness", "instrumentalness",
                 "loudness", "dynamic_range", "spectral_complexity"):
        cur.execute(f"""
            DO $$ BEGIN
                ALTER TABLE library_tracks ADD COLUMN {col} DOUBLE PRECISION;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)
    for col, default in [("analysis_state", "pending"), ("bliss_state", "pending")]:
        cur.execute(f"""
            DO $$ BEGIN
                ALTER TABLE library_tracks ADD COLUMN {col} TEXT DEFAULT '{default}';
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)


def _m04_add_artist_metadata_columns(cur):
    cur.execute("""
        DO $$ BEGIN
            ALTER TABLE library_artists ADD COLUMN folder_name TEXT;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    """)
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


def _m05_add_bliss_vector(cur):
    cur.execute("""
        DO $$ BEGIN
            ALTER TABLE library_tracks ADD COLUMN bliss_vector DOUBLE PRECISION[];
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    """)
    # Mark existing analyzed tracks as 'done' so daemons don't re-process them
    cur.execute("""
        UPDATE library_tracks SET analysis_state = 'done'
        WHERE bpm IS NOT NULL AND energy IS NOT NULL AND analysis_state = 'pending'
    """)
    cur.execute("""
        UPDATE library_tracks SET bliss_state = 'done'
        WHERE bliss_vector IS NOT NULL AND bliss_state = 'pending'
    """)


def _m06_add_popularity_columns(cur):
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


def _m07_add_album_metadata(cur):
    for col in ("tag_album", "musicbrainz_releasegroupid", "discogs_master_id"):
        cur.execute(f"""
            DO $$ BEGIN
                ALTER TABLE library_albums ADD COLUMN {col} TEXT;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)


def _m08_add_task_events_fk(cur):
    cur.execute("""
        DO $$ BEGIN
            ALTER TABLE task_events ADD CONSTRAINT fk_task_events_task
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
    """)


def _m09_add_playlist_extended_columns(cur):
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


def _m10_fix_user_followed_playlists_fk(cur):
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


def _m11_add_navidrome_ids(cur):
    for table in ("library_tracks", "library_albums", "library_artists"):
        cur.execute(f"""
            DO $$ BEGIN
                ALTER TABLE {table} ADD COLUMN navidrome_id TEXT;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)


def _m12_add_shows_address_columns(cur):
    for col, col_type in [("address_line1", "TEXT"), ("postal_code", "TEXT")]:
        cur.execute(f"""
            DO $$ BEGIN
                ALTER TABLE shows ADD COLUMN {col} {col_type};
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)


def _m13_add_track_rating(cur):
    cur.execute("""
        DO $$ BEGIN
            ALTER TABLE library_tracks ADD COLUMN rating INTEGER DEFAULT 0;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    """)


def _m14_add_tasks_dramatiq_columns(cur):
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


def _m15_add_new_releases_columns(cur):
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


def _m16_user_liked_tracks_v2(cur):
    cur.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM settings WHERE key = 'migration:user_liked_tracks_v2_applied'
            ) THEN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name = 'user_liked_tracks' AND column_name = 'track_path'
                ) THEN
                    DROP TABLE user_liked_tracks;
                END IF;
                INSERT INTO settings (key, value)
                VALUES ('migration:user_liked_tracks_v2_applied', 'true')
                ON CONFLICT (key) DO NOTHING;
            END IF;
        END
        $$
    """)


def _m17_add_play_history_track_id(cur):
    cur.execute("""
        DO $$ BEGIN
            ALTER TABLE play_history ADD COLUMN track_id INTEGER REFERENCES library_tracks(id) ON DELETE SET NULL;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    """)


def _m18_add_favorites_user_id(cur):
    cur.execute("""
        DO $$ BEGIN
            ALTER TABLE favorites ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    """)


def _m00_add_username_column(cur):
    cur.execute("""
        DO $$ BEGIN
            ALTER TABLE users ADD COLUMN username TEXT UNIQUE;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    """)


# ---------------------------------------------------------------------------
# Migration registry — (version, name, handler)
# ---------------------------------------------------------------------------

_MIGRATIONS = [
    (1, "add_artist_id_sequence", _m01_add_artist_id_sequence),
    (2, "add_slug_columns", _m02_add_slug_columns),
    (3, "add_audio_analysis_columns", _m03_add_audio_analysis_columns),
    (4, "add_artist_metadata_columns", _m04_add_artist_metadata_columns),
    (5, "add_bliss_vector", _m05_add_bliss_vector),
    (6, "add_popularity_columns", _m06_add_popularity_columns),
    (7, "add_album_metadata", _m07_add_album_metadata),
    (8, "add_task_events_fk", _m08_add_task_events_fk),
    (9, "add_playlist_extended_columns", _m09_add_playlist_extended_columns),
    (10, "fix_user_followed_playlists_fk", _m10_fix_user_followed_playlists_fk),
    (11, "add_navidrome_ids", _m11_add_navidrome_ids),
    (12, "add_shows_address_columns", _m12_add_shows_address_columns),
    (13, "add_track_rating", _m13_add_track_rating),
    (14, "add_tasks_dramatiq_columns", _m14_add_tasks_dramatiq_columns),
    (15, "add_new_releases_columns", _m15_add_new_releases_columns),
    (16, "user_liked_tracks_v2", _m16_user_liked_tracks_v2),
    (17, "add_play_history_track_id", _m17_add_play_history_track_id),
    (18, "add_favorites_user_id", _m18_add_favorites_user_id),
    (19, "add_username_column", _m00_add_username_column),
]
