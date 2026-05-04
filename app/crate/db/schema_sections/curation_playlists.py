"""Playlist and collaboration schema bootstrap helpers."""


def create_playlist_schema(cur) -> None:
    cur.execute(
        """
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
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_playlists_scope_active
        ON playlists(scope, is_active, updated_at DESC)
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_playlists_curated
        ON playlists(is_curated, category, featured_rank)
        """
    )
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_curation_key
        ON playlists(curation_key) WHERE curation_key IS NOT NULL
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS playlist_tracks (
            id SERIAL PRIMARY KEY,
            playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            track_id INTEGER REFERENCES library_tracks(id) ON DELETE SET NULL,
            track_entity_uid UUID,
            track_storage_id UUID,
            track_path TEXT NOT NULL,
            title TEXT,
            artist TEXT,
            album TEXT,
            duration DOUBLE PRECISION DEFAULT 0,
            position INTEGER NOT NULL,
            added_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id, position)")
    cur.execute("ALTER TABLE playlist_tracks ADD COLUMN IF NOT EXISTS track_entity_uid UUID")
    cur.execute("ALTER TABLE playlist_tracks ADD COLUMN IF NOT EXISTS track_storage_id UUID")
    cur.execute(
        """
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='playlist_tracks' AND column_name='track_id') THEN
                EXECUTE 'CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks(track_id)';
            END IF;
        END $$
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track_entity_uid
        ON playlist_tracks(track_entity_uid)
        WHERE track_entity_uid IS NOT NULL
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track_storage_id
        ON playlist_tracks(track_storage_id)
        WHERE track_storage_id IS NOT NULL
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS playlist_members (
            playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL DEFAULT 'collab',
            invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (playlist_id, user_id)
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_playlist_members_user ON playlist_members(user_id, created_at DESC)")

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS playlist_invites (
            token TEXT PRIMARY KEY,
            playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            expires_at TIMESTAMPTZ,
            max_uses INTEGER,
            use_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_playlist_invites_playlist ON playlist_invites(playlist_id, created_at DESC)")

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS user_followed_playlists (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            followed_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (user_id, playlist_id)
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_followed_playlists_user ON user_followed_playlists(user_id, followed_at DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_followed_playlists_playlist ON user_followed_playlists(playlist_id)")


__all__ = [
    "create_playlist_schema",
]
