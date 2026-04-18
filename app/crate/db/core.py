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
    Connects as the Postgres superuser (POSTGRES_SUPERUSER_*) to provision
    the app-level role (CRATE_POSTGRES_*). Idempotent and safe to call on
    every startup. Skips silently if superuser creds are not available."""
    global _db_provisioned
    if _db_provisioned:
        return
    _db_provisioned = True

    su_user = os.environ.get("POSTGRES_SUPERUSER_USER") or os.environ.get("MUSICDOCK_POSTGRES_USER")
    su_pass = os.environ.get("POSTGRES_SUPERUSER_PASSWORD") or os.environ.get("MUSICDOCK_POSTGRES_PASSWORD")
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
        su_db = os.environ.get("POSTGRES_SUPERUSER_DB") or os.environ.get("MUSICDOCK_POSTGRES_DB", "postgres")
        conn = psycopg2.connect(
            host=host, port=port, user=su_user, password=su_pass,
            dbname=su_db,
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
        # Legacy migration tracker — kept for backward compat so
        # existing installs don't lose their migration history.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS schema_versions (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)

        # Idempotent schema creation — defines the FINAL shape of all
        # tables. Safe to run on every boot; new installs get everything,
        # existing installs get missing columns via IF NOT EXISTS.
        _create_schema(cur)

        # Legacy in-app migrations. Frozen at version 29. New schema
        # changes go through Alembic (see below). This call is kept so
        # installs upgrading from pre-Alembic versions still apply the
        # 29 legacy migrations before Alembic takes over.
        _run_migrations(cur)

    # ── Alembic: apply any pending Alembic-managed migrations ──
    #
    # This replaces the old pattern of growing _MIGRATIONS. New schema
    # changes are Alembic revision files in crate/db/migrations/versions/.
    #
    # On first run against a pre-Alembic DB, `upgrade head` creates the
    # alembic_version table and stamps the baseline (001). Subsequent
    # boots only run migrations newer than the stamped head.
    _run_alembic_upgrade()

    # Seeds run last — they depend on the schema being fully up to date.
    from crate.db.tx import transaction_scope
    with transaction_scope() as session:
        from crate.genre_taxonomy import seed_genre_taxonomy
        from crate.db.auth import _seed_admin
        seed_genre_taxonomy(session)
        _seed_admin(session)


def _run_alembic_upgrade():
    """Run ``alembic upgrade head`` programmatically.

    Uses the same DSN env vars as the rest of the app. The advisory
    lock in ``init_db()`` ensures only one process runs this at a time.
    """
    import os
    from alembic.config import Config
    from alembic import command

    # Locate alembic.ini relative to the app directory (one level up
    # from crate/db/core.py → app/).
    app_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ini_path = os.path.join(app_dir, "alembic.ini")

    if not os.path.exists(ini_path):
        log.warning("alembic.ini not found at %s — skipping Alembic migrations", ini_path)
        return

    alembic_cfg = Config(ini_path)
    # Override script_location to be absolute so it works regardless of cwd
    alembic_cfg.set_main_option(
        "script_location",
        os.path.join(app_dir, "crate", "db", "migrations"),
    )

    try:
        command.upgrade(alembic_cfg, "head")
        log.info("Alembic migrations applied successfully (head)")
    except Exception as exc:
        log.error("Alembic migration failed: %s", exc)
        raise


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
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            priority INTEGER DEFAULT 2,
            pool TEXT DEFAULT 'default',
            parent_task_id TEXT,
            max_duration_sec INTEGER DEFAULT 1800,
            heartbeat_at TIMESTAMPTZ,
            worker_id TEXT,
            retry_count INTEGER DEFAULT 0,
            max_retries INTEGER DEFAULT 0,
            started_at TIMESTAMPTZ
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
            scanned_at TIMESTAMPTZ NOT NULL
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
            created_at TIMESTAMPTZ NOT NULL,
            resolved_at TIMESTAMPTZ
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
            detected_at TIMESTAMPTZ NOT NULL,
            downloaded_at TIMESTAMPTZ,
            release_date DATE,
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
            created_at TIMESTAMPTZ NOT NULL,
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
            created_at TIMESTAMPTZ NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_mb_cache_created ON mb_cache(created_at)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS cache (
            key TEXT PRIMARY KEY,
            value_json JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
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
            bio TEXT,
            password_hash TEXT,
            avatar TEXT,
            role TEXT NOT NULL DEFAULT 'user',
            google_id TEXT UNIQUE,
            created_at TIMESTAMPTZ NOT NULL,
            last_login TIMESTAMPTZ
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ,
            last_seen_at TIMESTAMPTZ,
            last_seen_ip TEXT,
            user_agent TEXT,
            app_id TEXT,
            device_label TEXT
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)")
    cur.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'sessions'
                  AND column_name = 'last_seen_at'
            ) THEN
                EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen_at DESC)';
            END IF;
        END $$;
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
            last_synced_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            UNIQUE (user_id, provider)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_external_identities_provider ON user_external_identities(provider)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_external_identities_provider_username ON user_external_identities(provider, external_username) WHERE external_username IS NOT NULL")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_external_identities_provider_user_id ON user_external_identities(provider, external_user_id) WHERE external_user_id IS NOT NULL")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS auth_invites (
            token TEXT PRIMARY KEY,
            email TEXT,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            expires_at TIMESTAMPTZ,
            max_uses INTEGER,
            use_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL,
            accepted_at TIMESTAMPTZ
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_auth_invites_created_by ON auth_invites(created_by, created_at DESC)")

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
            updated_at TIMESTAMPTZ,
            id BIGINT DEFAULT nextval('library_artists_id_seq'),
            storage_id UUID NOT NULL,
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
            enriched_at TIMESTAMPTZ,
            discogs_id TEXT,
            spotify_followers INTEGER,
            lastfm_playcount BIGINT,
            discogs_profile TEXT,
            discogs_members_json JSONB,
            latest_release_date TEXT,
            content_hash TEXT
        )
    """)
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_artists_id ON library_artists(id)")
    # storage_id index created in _m23 migration for existing DBs; here for fresh installs only
    cur.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='library_artists' AND column_name='storage_id') THEN
                EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_artists_storage_id ON library_artists(storage_id)';
            END IF;
        END $$
    """)
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_artists_slug ON library_artists(slug)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_artists_name_trgm ON library_artists USING gin(name gin_trgm_ops)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS library_albums (
            id SERIAL PRIMARY KEY,
            storage_id UUID NOT NULL,
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
            updated_at TIMESTAMPTZ,
            slug TEXT,
            tag_album TEXT,
            musicbrainz_releasegroupid TEXT,
            discogs_master_id TEXT,
            lastfm_listeners INTEGER,
            lastfm_playcount BIGINT,
            popularity INTEGER,
            UNIQUE(artist, name)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_lib_albums_artist ON library_albums(artist)")
    cur.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='library_albums' AND column_name='storage_id') THEN
                EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_albums_storage_id ON library_albums(storage_id)';
            END IF;
        END $$
    """)
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_albums_slug ON library_albums(slug)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_albums_name_trgm ON library_albums USING gin(name gin_trgm_ops)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_albums_artist_name ON library_albums(artist, name)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS library_tracks (
            id SERIAL PRIMARY KEY,
            storage_id UUID NOT NULL,
            album_id INTEGER REFERENCES library_albums(id) ON DELETE CASCADE,
            artist TEXT NOT NULL,
            album TEXT NOT NULL,
            filename TEXT NOT NULL,
            title TEXT,
            track_number INTEGER,
            disc_number INTEGER DEFAULT 1,
            format TEXT,
            bitrate INTEGER,
            sample_rate INTEGER,
            bit_depth INTEGER,
            duration DOUBLE PRECISION,
            size BIGINT,
            year TEXT,
            genre TEXT,
            albumartist TEXT,
            musicbrainz_albumid TEXT,
            musicbrainz_trackid TEXT,
            path TEXT UNIQUE NOT NULL,
            updated_at TIMESTAMPTZ,
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
            rating INTEGER DEFAULT 0
        )
    """)
    cur.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='library_tracks' AND column_name='storage_id') THEN
                EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_tracks_storage_id ON library_tracks(storage_id)';
            END IF;
        END $$
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
    cur.execute("""
        CREATE TABLE IF NOT EXISTS genre_taxonomy_nodes (
            id SERIAL PRIMARY KEY,
            slug TEXT UNIQUE NOT NULL,
            name TEXT UNIQUE NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            external_description TEXT NOT NULL DEFAULT '',
            external_description_source TEXT NOT NULL DEFAULT '',
            musicbrainz_mbid TEXT,
            wikidata_entity_id TEXT,
            wikidata_url TEXT,
            is_top_level BOOLEAN NOT NULL DEFAULT FALSE,
            eq_gains DOUBLE PRECISION[]
        )
    """)
    # Migration: ensure eq_gains exists on upgraded installs where the
    # table was created before this column was introduced.
    cur.execute("""
        ALTER TABLE genre_taxonomy_nodes
        ADD COLUMN IF NOT EXISTS eq_gains DOUBLE PRECISION[]
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS genre_taxonomy_aliases (
            alias_slug TEXT PRIMARY KEY,
            alias_name TEXT UNIQUE NOT NULL,
            genre_id INTEGER NOT NULL REFERENCES genre_taxonomy_nodes(id) ON DELETE CASCADE
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS genre_taxonomy_edges (
            source_genre_id INTEGER NOT NULL REFERENCES genre_taxonomy_nodes(id) ON DELETE CASCADE,
            target_genre_id INTEGER NOT NULL REFERENCES genre_taxonomy_nodes(id) ON DELETE CASCADE,
            relation_type TEXT NOT NULL,
            weight DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            PRIMARY KEY (source_genre_id, target_genre_id, relation_type)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_genre_taxonomy_alias_genre_id ON genre_taxonomy_aliases(genre_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_genre_taxonomy_edges_source ON genre_taxonomy_edges(source_genre_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_genre_taxonomy_edges_target ON genre_taxonomy_edges(target_genre_id)")
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_genre_taxonomy_nodes_musicbrainz_mbid
        ON genre_taxonomy_nodes(musicbrainz_mbid)
        WHERE musicbrainz_mbid IS NOT NULL
        """
    )

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
            created_at TIMESTAMPTZ NOT NULL,
            completed_at TIMESTAMPTZ
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_tidal_downloads_status ON tidal_downloads(status)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS tidal_monitored_artists (
            artist_name TEXT PRIMARY KEY,
            tidal_id TEXT,
            last_checked TIMESTAMPTZ,
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
            visibility TEXT NOT NULL DEFAULT 'private',
            is_collaborative BOOLEAN NOT NULL DEFAULT FALSE,
            generation_mode TEXT NOT NULL DEFAULT 'static',
            is_curated BOOLEAN NOT NULL DEFAULT FALSE,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            managed_by_user_id INTEGER REFERENCES users(id),
            curation_key TEXT,
            featured_rank INTEGER,
            category TEXT,
            track_count INTEGER DEFAULT 0,
            total_duration DOUBLE PRECISION DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
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
            track_id INTEGER REFERENCES library_tracks(id) ON DELETE SET NULL,
            track_path TEXT NOT NULL,
            title TEXT,
            artist TEXT,
            album TEXT,
            duration DOUBLE PRECISION DEFAULT 0,
            position INTEGER NOT NULL,
            added_at TIMESTAMPTZ NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id, position)")
    cur.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='playlist_tracks' AND column_name='track_id') THEN
                EXECUTE 'CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks(track_id)';
            END IF;
        END $$
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS playlist_members (
            playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL DEFAULT 'collab',
            invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (playlist_id, user_id)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_playlist_members_user ON playlist_members(user_id, created_at DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS playlist_invites (
            token TEXT PRIMARY KEY,
            playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            expires_at TIMESTAMPTZ,
            max_uses INTEGER,
            use_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_playlist_invites_playlist ON playlist_invites(playlist_id, created_at DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_followed_playlists (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            followed_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (user_id, playlist_id)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_followed_playlists_user ON user_followed_playlists(user_id, followed_at DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_followed_playlists_playlist ON user_followed_playlists(playlist_id)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_relationships (
            follower_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            followed_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (follower_user_id, followed_user_id),
            CHECK (follower_user_id != followed_user_id)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_relationships_followed ON user_relationships(followed_user_id, created_at DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_affinity_cache (
            user_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            user_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            affinity_score INTEGER NOT NULL DEFAULT 0,
            affinity_band TEXT NOT NULL DEFAULT 'low',
            reasons_json JSONB DEFAULT '[]',
            computed_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (user_a_id, user_b_id),
            CHECK (user_a_id < user_b_id)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_affinity_cache_score ON user_affinity_cache(affinity_score DESC, computed_at DESC)")

    # ── Audit ─────────────────────────────────────────────────────

    cur.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMPTZ NOT NULL,
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
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL,
            UNIQUE(item_type, item_id)
        )
    """)

    # ── Shows ─────────────────────────────────────────────────────

    cur.execute("""
        CREATE TABLE IF NOT EXISTS shows (
            id SERIAL PRIMARY KEY,
            external_id TEXT UNIQUE,
            artist_name TEXT NOT NULL,
            date DATE NOT NULL,
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
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
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
            created_at TIMESTAMPTZ NOT NULL,
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
            created_at TIMESTAMPTZ NOT NULL,
            triggered_at TIMESTAMPTZ,
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
            updated_at TIMESTAMPTZ NOT NULL,
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
            created_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (user_id, artist_name)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_follows_user ON user_follows(user_id)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_saved_albums (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            album_id INTEGER NOT NULL REFERENCES library_albums(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (user_id, album_id)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_saved_albums_user ON user_saved_albums(user_id)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_liked_tracks (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            track_id INTEGER NOT NULL REFERENCES library_tracks(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL,
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
            played_at TIMESTAMPTZ NOT NULL
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
            started_at TIMESTAMPTZ NOT NULL,
            ended_at TIMESTAMPTZ NOT NULL,
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
            created_at TIMESTAMPTZ NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_play_events_user ON user_play_events(user_id, ended_at DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_play_events_track ON user_play_events(track_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_play_events_source ON user_play_events(user_id, play_source_type, ended_at DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_play_events_user_artist ON user_play_events(user_id, artist, ended_at DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_play_events_user_album ON user_play_events(user_id, album, ended_at DESC)")
    # idx_user_play_events_user_day is created in migration 20 after TIMESTAMPTZ conversion

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_daily_listening (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            day DATE NOT NULL,
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
            first_played_at TIMESTAMPTZ,
            last_played_at TIMESTAMPTZ,
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
            first_played_at TIMESTAMPTZ,
            last_played_at TIMESTAMPTZ,
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
            first_played_at TIMESTAMPTZ,
            last_played_at TIMESTAMPTZ,
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
            first_played_at TIMESTAMPTZ,
            last_played_at TIMESTAMPTZ,
            PRIMARY KEY (user_id, stat_window, genre_name)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_genre_stats_lookup ON user_genre_stats(user_id, stat_window, play_count DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS jam_rooms (
            id UUID PRIMARY KEY,
            host_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            current_track_payload JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL,
            ended_at TIMESTAMPTZ
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_jam_rooms_host ON jam_rooms(host_user_id, created_at DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS jam_room_members (
            room_id UUID NOT NULL REFERENCES jam_rooms(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL DEFAULT 'collab',
            joined_at TIMESTAMPTZ NOT NULL,
            last_seen_at TIMESTAMPTZ,
            PRIMARY KEY (room_id, user_id)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_jam_room_members_user ON jam_room_members(user_id, joined_at DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS jam_room_invites (
            token TEXT PRIMARY KEY,
            room_id UUID NOT NULL REFERENCES jam_rooms(id) ON DELETE CASCADE,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            expires_at TIMESTAMPTZ,
            max_uses INTEGER,
            use_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_jam_room_invites_room ON jam_room_invites(room_id, created_at DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS jam_room_events (
            id BIGSERIAL PRIMARY KEY,
            room_id UUID NOT NULL REFERENCES jam_rooms(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            event_type TEXT NOT NULL,
            payload_json JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_jam_room_events_room ON jam_room_events(room_id, id DESC)")


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


def _m20_convert_to_timestamptz(cur):
    """Convert TEXT date/time columns to TIMESTAMPTZ/DATE for proper temporal queries."""
    conversions = [
        # (table, column, target_type)
        ("tasks", "created_at", "TIMESTAMPTZ"),
        ("tasks", "updated_at", "TIMESTAMPTZ"),
        ("tasks", "started_at", "TIMESTAMPTZ"),
        ("tasks", "heartbeat_at", "TIMESTAMPTZ"),
        ("scan_results", "scanned_at", "TIMESTAMPTZ"),
        ("health_issues", "created_at", "TIMESTAMPTZ"),
        ("health_issues", "resolved_at", "TIMESTAMPTZ"),
        ("new_releases", "detected_at", "TIMESTAMPTZ"),
        ("new_releases", "downloaded_at", "TIMESTAMPTZ"),
        ("new_releases", "release_date", "DATE"),
        ("task_events", "created_at", "TIMESTAMPTZ"),
        ("cache", "updated_at", "TIMESTAMPTZ"),
        ("mb_cache", "created_at", "TIMESTAMPTZ"),
        ("users", "created_at", "TIMESTAMPTZ"),
        ("users", "last_login", "TIMESTAMPTZ"),
        ("sessions", "expires_at", "TIMESTAMPTZ"),
        ("sessions", "created_at", "TIMESTAMPTZ"),
        ("user_external_identities", "last_synced_at", "TIMESTAMPTZ"),
        ("user_external_identities", "created_at", "TIMESTAMPTZ"),
        ("user_external_identities", "updated_at", "TIMESTAMPTZ"),
        ("library_artists", "updated_at", "TIMESTAMPTZ"),
        ("library_artists", "enriched_at", "TIMESTAMPTZ"),
        ("library_albums", "updated_at", "TIMESTAMPTZ"),
        ("library_tracks", "updated_at", "TIMESTAMPTZ"),
        ("tidal_downloads", "created_at", "TIMESTAMPTZ"),
        ("tidal_downloads", "completed_at", "TIMESTAMPTZ"),
        ("tidal_monitored_artists", "last_checked", "TIMESTAMPTZ"),
        ("playlists", "created_at", "TIMESTAMPTZ"),
        ("playlists", "updated_at", "TIMESTAMPTZ"),
        ("playlist_tracks", "added_at", "TIMESTAMPTZ"),
        ("user_followed_playlists", "followed_at", "TIMESTAMPTZ"),
        ("audit_log", "timestamp", "TIMESTAMPTZ"),
        ("shows", "date", "DATE"),
        ("shows", "created_at", "TIMESTAMPTZ"),
        ("shows", "updated_at", "TIMESTAMPTZ"),
        ("user_show_attendance", "created_at", "TIMESTAMPTZ"),
        ("user_show_reminders", "created_at", "TIMESTAMPTZ"),
        ("user_show_reminders", "triggered_at", "TIMESTAMPTZ"),
        ("artist_similarities", "updated_at", "TIMESTAMPTZ"),
        ("favorites", "created_at", "TIMESTAMPTZ"),
        ("user_follows", "created_at", "TIMESTAMPTZ"),
        ("user_saved_albums", "created_at", "TIMESTAMPTZ"),
        ("user_liked_tracks", "created_at", "TIMESTAMPTZ"),
        ("play_history", "played_at", "TIMESTAMPTZ"),
        ("user_play_events", "started_at", "TIMESTAMPTZ"),
        ("user_play_events", "ended_at", "TIMESTAMPTZ"),
        ("user_play_events", "created_at", "TIMESTAMPTZ"),
        ("user_daily_listening", "day", "DATE"),
        ("user_track_stats", "first_played_at", "TIMESTAMPTZ"),
        ("user_track_stats", "last_played_at", "TIMESTAMPTZ"),
        ("user_artist_stats", "first_played_at", "TIMESTAMPTZ"),
        ("user_artist_stats", "last_played_at", "TIMESTAMPTZ"),
        ("user_album_stats", "first_played_at", "TIMESTAMPTZ"),
        ("user_album_stats", "last_played_at", "TIMESTAMPTZ"),
        ("user_genre_stats", "first_played_at", "TIMESTAMPTZ"),
        ("user_genre_stats", "last_played_at", "TIMESTAMPTZ"),
    ]
    # Drop indexes that use substring() on columns being converted — they'd
    # block the ALTER TYPE and can't be recalculated for TIMESTAMPTZ.
    cur.execute("DROP INDEX IF EXISTS idx_user_play_events_user_day")

    for table, column, target_type in conversions:
        try:
            cur.execute("SAVEPOINT sp_ts")
            cast_type = 'timestamptz' if target_type == 'TIMESTAMPTZ' else 'date'
            cur.execute(f"""
                ALTER TABLE {table}
                ALTER COLUMN {column} TYPE {target_type}
                USING NULLIF({column}, '')::{cast_type}
            """)
            cur.execute("RELEASE SAVEPOINT sp_ts")
        except Exception:
            cur.execute("ROLLBACK TO SAVEPOINT sp_ts")
            log.debug("Column %s.%s already converted or missing", table, column)

    # Recreate functional index that depends on TIMESTAMPTZ type
    try:
        cur.execute("SAVEPOINT sp_idx")
        cur.execute("DROP INDEX IF EXISTS idx_user_play_events_user_day")
        cur.execute(
            "CREATE INDEX idx_user_play_events_user_day "
            "ON user_play_events(user_id, ((ended_at AT TIME ZONE 'UTC')::date))"
        )
        cur.execute("RELEASE SAVEPOINT sp_idx")
    except Exception:
        cur.execute("ROLLBACK TO SAVEPOINT sp_idx")
        log.warning("Could not create TIMESTAMPTZ-based index on user_play_events.ended_at")


def _m21_identity_social_collab_foundation(cur):
    cur.execute("""
        DO $$ BEGIN
            ALTER TABLE users ADD COLUMN bio TEXT;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    """)
    for col, col_type in [
        ("revoked_at", "TIMESTAMPTZ"),
        ("last_seen_at", "TIMESTAMPTZ"),
        ("last_seen_ip", "TEXT"),
        ("user_agent", "TEXT"),
        ("app_id", "TEXT"),
        ("device_label", "TEXT"),
    ]:
        cur.execute(f"""
            DO $$ BEGIN
                ALTER TABLE sessions ADD COLUMN {col} {col_type};
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen_at DESC)")
    cur.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_user_external_identities_provider_user_id
        ON user_external_identities(provider, external_user_id)
        WHERE external_user_id IS NOT NULL
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS auth_invites (
            token TEXT PRIMARY KEY,
            email TEXT,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            expires_at TIMESTAMPTZ,
            max_uses INTEGER,
            use_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL,
            accepted_at TIMESTAMPTZ
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_auth_invites_created_by ON auth_invites(created_by, created_at DESC)")

    for col, col_type, default in [
        ("visibility", "TEXT", "'private'"),
        ("is_collaborative", "BOOLEAN", "FALSE"),
    ]:
        cur.execute(f"""
            DO $$ BEGIN
                ALTER TABLE playlists ADD COLUMN {col} {col_type} DEFAULT {default};
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)

    cur.execute("""
        UPDATE playlists
        SET visibility = CASE WHEN scope = 'system' THEN 'public' ELSE COALESCE(visibility, 'private') END
        WHERE visibility IS NULL OR visibility = ''
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS playlist_members (
            playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL DEFAULT 'collab',
            invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (playlist_id, user_id)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_playlist_members_user ON playlist_members(user_id, created_at DESC)")
    cur.execute("""
        INSERT INTO playlist_members (playlist_id, user_id, role, created_at)
        SELECT id, user_id, 'owner', COALESCE(created_at, NOW())
        FROM playlists
        WHERE user_id IS NOT NULL
        ON CONFLICT (playlist_id, user_id) DO NOTHING
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS playlist_invites (
            token TEXT PRIMARY KEY,
            playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            expires_at TIMESTAMPTZ,
            max_uses INTEGER,
            use_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_playlist_invites_playlist ON playlist_invites(playlist_id, created_at DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_relationships (
            follower_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            followed_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (follower_user_id, followed_user_id),
            CHECK (follower_user_id != followed_user_id)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_relationships_followed ON user_relationships(followed_user_id, created_at DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_affinity_cache (
            user_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            user_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            affinity_score INTEGER NOT NULL DEFAULT 0,
            affinity_band TEXT NOT NULL DEFAULT 'low',
            reasons_json JSONB DEFAULT '[]',
            computed_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (user_a_id, user_b_id),
            CHECK (user_a_id < user_b_id)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_affinity_cache_score ON user_affinity_cache(affinity_score DESC, computed_at DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS jam_rooms (
            id UUID PRIMARY KEY,
            host_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            current_track_payload JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL,
            ended_at TIMESTAMPTZ
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_jam_rooms_host ON jam_rooms(host_user_id, created_at DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS jam_room_members (
            room_id UUID NOT NULL REFERENCES jam_rooms(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL DEFAULT 'collab',
            joined_at TIMESTAMPTZ NOT NULL,
            last_seen_at TIMESTAMPTZ,
            PRIMARY KEY (room_id, user_id)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_jam_room_members_user ON jam_room_members(user_id, joined_at DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS jam_room_invites (
            token TEXT PRIMARY KEY,
            room_id UUID NOT NULL REFERENCES jam_rooms(id) ON DELETE CASCADE,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            expires_at TIMESTAMPTZ,
            max_uses INTEGER,
            use_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_jam_room_invites_room ON jam_room_invites(room_id, created_at DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS jam_room_events (
            id BIGSERIAL PRIMARY KEY,
            room_id UUID NOT NULL REFERENCES jam_rooms(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            event_type TEXT NOT NULL,
            payload_json JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_jam_room_events_room ON jam_room_events(room_id, id DESC)")


def _m22_add_subsonic_token(cur):
    cur.execute("""
        DO $$ BEGIN
            ALTER TABLE users ADD COLUMN subsonic_token TEXT;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    """)


def _m23_add_storage_ids_and_playlist_track_id(cur):
    for table in ("library_artists", "library_albums", "library_tracks"):
        cur.execute(f"""
            DO $$ BEGIN
                ALTER TABLE {table} ADD COLUMN storage_id UUID;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)

    cur.execute("""
        DO $$ BEGIN
            ALTER TABLE playlist_tracks ADD COLUMN track_id INTEGER REFERENCES library_tracks(id) ON DELETE SET NULL;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    """)

    for table, pk in (
        ("library_artists", "name"),
        ("library_albums", "id"),
        ("library_tracks", "id"),
    ):
        cur.execute(f"SELECT {pk} AS pk FROM {table} WHERE storage_id IS NULL")
        for row in cur.fetchall():
            cur.execute(
                f"UPDATE {table} SET storage_id = %s WHERE {pk} = %s",
                (str(uuid.uuid4()), row["pk"]),
            )

    cur.execute("""
        UPDATE playlist_tracks pt
        SET track_id = (
            SELECT lt.id
            FROM library_tracks lt
            WHERE lt.path = pt.track_path
               OR (pt.track_path != '' AND pt.track_path IS NOT NULL
                   AND lt.path LIKE ('%%/' || pt.track_path)
                   AND LENGTH(pt.track_path) > 5)
            ORDER BY CASE WHEN lt.path = pt.track_path THEN 0 ELSE 1 END
            LIMIT 1
        )
        WHERE pt.track_id IS NULL
    """)

    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_artists_storage_id ON library_artists(storage_id)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_albums_storage_id ON library_albums(storage_id)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_tracks_storage_id ON library_tracks(storage_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks(track_id)")

    cur.execute("ALTER TABLE library_artists ALTER COLUMN storage_id SET NOT NULL")
    cur.execute("ALTER TABLE library_albums ALTER COLUMN storage_id SET NOT NULL")
    cur.execute("ALTER TABLE library_tracks ALTER COLUMN storage_id SET NOT NULL")

    # Additional indexes for common query patterns
    cur.execute("CREATE INDEX IF NOT EXISTS idx_artist_genres_artist ON artist_genres(artist_name)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_playlist_members_composite ON playlist_members(playlist_id, user_id)")


def _m24_genre_taxonomy_descriptions_and_lowercase_names(cur):
    cur.execute("""
        DO $$ BEGIN
            ALTER TABLE genre_taxonomy_nodes ADD COLUMN description TEXT NOT NULL DEFAULT '';
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    """)
    cur.execute("UPDATE genre_taxonomy_nodes SET name = LOWER(BTRIM(name)), description = LOWER(BTRIM(COALESCE(description, '')))")
    cur.execute("UPDATE genre_taxonomy_aliases SET alias_name = LOWER(BTRIM(alias_name))")
    cur.execute("UPDATE genres SET name = LOWER(BTRIM(name))")


def _m25_genre_taxonomy_external_metadata(cur):
    cur.execute("""
        DO $$ BEGIN
            ALTER TABLE genre_taxonomy_nodes ADD COLUMN external_description TEXT NOT NULL DEFAULT '';
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    """)
    cur.execute("""
        DO $$ BEGIN
            ALTER TABLE genre_taxonomy_nodes ADD COLUMN external_description_source TEXT NOT NULL DEFAULT '';
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    """)
    for column in ("musicbrainz_mbid", "wikidata_entity_id", "wikidata_url"):
        cur.execute(f"""
            DO $$ BEGIN
                ALTER TABLE genre_taxonomy_nodes ADD COLUMN {column} TEXT;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)


def _m26_genre_taxonomy_musicbrainz_index(cur):
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_genre_taxonomy_nodes_musicbrainz_mbid
        ON genre_taxonomy_nodes(musicbrainz_mbid)
        WHERE musicbrainz_mbid IS NOT NULL
        """
    )


# ---------------------------------------------------------------------------
# Migration registry — (version, name, handler)
# ---------------------------------------------------------------------------

def _m27_add_track_sample_rate_and_bit_depth(cur):
    for col, typedef in (("sample_rate", "INTEGER"), ("bit_depth", "INTEGER")):
        cur.execute(f"""
            DO $$ BEGIN
                ALTER TABLE library_tracks ADD COLUMN {col} {typedef};
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)


def _m28_add_user_location_fields(cur):
    for col, typedef in (
        ("city", "TEXT"),
        ("country", "TEXT"),
        ("country_code", "TEXT"),
        ("latitude", "DOUBLE PRECISION"),
        ("longitude", "DOUBLE PRECISION"),
        ("show_radius_km", "INTEGER DEFAULT 60"),
        ("show_location_mode", "TEXT DEFAULT 'fixed'"),
    ):
        cur.execute(f"""
            DO $$ BEGIN
                ALTER TABLE users ADD COLUMN {col} {typedef};
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)


def _m29_add_shows_lastfm_fields(cur):
    for col, typedef in (
        ("lastfm_event_id", "TEXT"),
        ("lastfm_url", "TEXT"),
        ("lastfm_attendance", "INTEGER"),
        ("tickets_url", "TEXT"),
        ("scrape_city", "TEXT"),
    ):
        cur.execute(f"""
            DO $$ BEGIN
                ALTER TABLE shows ADD COLUMN {col} {typedef};
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)
    cur.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_shows_lastfm_event
        ON shows(lastfm_event_id) WHERE lastfm_event_id IS NOT NULL
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_shows_scrape_city ON shows(scrape_city)")


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
    (12, "add_shows_address_columns", _m12_add_shows_address_columns),
    (13, "add_track_rating", _m13_add_track_rating),
    (14, "add_tasks_dramatiq_columns", _m14_add_tasks_dramatiq_columns),
    (15, "add_new_releases_columns", _m15_add_new_releases_columns),
    (16, "user_liked_tracks_v2", _m16_user_liked_tracks_v2),
    (17, "add_play_history_track_id", _m17_add_play_history_track_id),
    (18, "add_favorites_user_id", _m18_add_favorites_user_id),
    (19, "add_username_column", _m00_add_username_column),
    (20, "convert_to_timestamptz", _m20_convert_to_timestamptz),
    (21, "identity_social_collab_foundation", _m21_identity_social_collab_foundation),
    (22, "add_subsonic_token", _m22_add_subsonic_token),
    (23, "add_storage_ids_and_playlist_track_id", _m23_add_storage_ids_and_playlist_track_id),
    (24, "genre_taxonomy_descriptions_and_lowercase_names", _m24_genre_taxonomy_descriptions_and_lowercase_names),
    (25, "genre_taxonomy_external_metadata", _m25_genre_taxonomy_external_metadata),
    (26, "genre_taxonomy_musicbrainz_index", _m26_genre_taxonomy_musicbrainz_index),
    (27, "add_track_sample_rate_and_bit_depth", _m27_add_track_sample_rate_and_bit_depth),
    (28, "add_user_location_fields", _m28_add_user_location_fields),
    (29, "add_shows_lastfm_fields", _m29_add_shows_lastfm_fields),

]
