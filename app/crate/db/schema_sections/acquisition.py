"""Acquisition and external events schema bootstrap section."""


def create_acquisition_schema(cur) -> None:
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
            lastfm_event_id TEXT,
            lastfm_url TEXT,
            lastfm_attendance INTEGER,
            tickets_url TEXT,
            scrape_city TEXT,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_shows_date ON shows(date)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_shows_artist ON shows(artist_name)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_shows_city ON shows(city)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_shows_lastfm_event ON shows(lastfm_event_id) WHERE lastfm_event_id IS NOT NULL")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_shows_scrape_city ON shows(scrape_city)")

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
