"""Auth schema bootstrap section."""


def create_auth_schema(cur) -> None:
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
            last_login TIMESTAMPTZ,
            subsonic_token TEXT,
            city TEXT,
            country TEXT,
            country_code TEXT,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            show_location_mode TEXT DEFAULT 'fixed',
            show_radius_km INTEGER DEFAULT 60
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
            device_label TEXT,
            device_fingerprint TEXT
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)")
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_sessions_user_app_device
        ON sessions(user_id, app_id, device_fingerprint)
        WHERE revoked_at IS NULL AND device_fingerprint IS NOT NULL
    """)
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
    cur.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_user_external_identities_provider_username "
        "ON user_external_identities(provider, external_username) WHERE external_username IS NOT NULL"
    )
    cur.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_user_external_identities_provider_user_id "
        "ON user_external_identities(provider, external_user_id) WHERE external_user_id IS NOT NULL"
    )

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
