"""User library, listening analytics, and jam schema bootstrap section."""


def create_activity_schema(cur) -> None:
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

    cur.execute("""
        CREATE TABLE IF NOT EXISTS play_history (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            track_id INTEGER REFERENCES library_tracks(id) ON DELETE SET NULL,
            track_entity_uid UUID,
            track_path TEXT NOT NULL,
            title TEXT,
            artist TEXT,
            album TEXT,
            played_at TIMESTAMPTZ NOT NULL
        )
    """)
    cur.execute("ALTER TABLE play_history ADD COLUMN IF NOT EXISTS track_entity_uid UUID")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_play_history_user ON play_history(user_id, played_at DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_play_history_track ON play_history(track_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_play_history_track_entity_uid ON play_history(track_entity_uid)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_play_events (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            client_event_id TEXT,
            track_id INTEGER REFERENCES library_tracks(id) ON DELETE SET NULL,
            track_entity_uid UUID,
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
    cur.execute("ALTER TABLE user_play_events ADD COLUMN IF NOT EXISTS client_event_id TEXT")
    cur.execute("ALTER TABLE user_play_events ADD COLUMN IF NOT EXISTS track_entity_uid UUID")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_play_events_user ON user_play_events(user_id, ended_at DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_play_events_track ON user_play_events(track_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_play_events_track_entity_uid ON user_play_events(track_entity_uid)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_play_events_source ON user_play_events(user_id, play_source_type, ended_at DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_play_events_user_artist ON user_play_events(user_id, artist, ended_at DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_play_events_user_album ON user_play_events(user_id, album, ended_at DESC)")
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_user_play_events_user_client_event
        ON user_play_events(user_id, client_event_id)
        WHERE client_event_id IS NOT NULL
        """
    )

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
            track_entity_uid UUID,
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
    cur.execute("ALTER TABLE user_track_stats ADD COLUMN IF NOT EXISTS track_entity_uid UUID")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_track_stats_lookup ON user_track_stats(user_id, stat_window, play_count DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_track_stats_entity_uid ON user_track_stats(track_entity_uid)")

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
