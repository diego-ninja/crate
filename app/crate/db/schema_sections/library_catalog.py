"""Catalog tables and indexes for the library schema bootstrap."""


def create_library_catalog_schema(cur) -> None:
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
            storage_id UUID,
            entity_uid UUID,
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
    cur.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='library_artists' AND column_name='storage_id') THEN
                EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_artists_storage_id ON library_artists(storage_id) WHERE storage_id IS NOT NULL';
            END IF;
        END $$
    """)
    cur.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='library_artists' AND column_name='entity_uid') THEN
                EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_artists_entity_uid ON library_artists(entity_uid)';
            END IF;
        END $$
    """)
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_artists_slug ON library_artists(slug)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_artists_name_trgm ON library_artists USING gin(name gin_trgm_ops)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS library_albums (
            id SERIAL PRIMARY KEY,
            storage_id UUID,
            entity_uid UUID,
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
                EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_albums_storage_id ON library_albums(storage_id) WHERE storage_id IS NOT NULL';
            END IF;
        END $$
    """)
    cur.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='library_albums' AND column_name='entity_uid') THEN
                EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_albums_entity_uid ON library_albums(entity_uid)';
            END IF;
        END $$
    """)
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_albums_slug ON library_albums(slug)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_albums_name_trgm ON library_albums USING gin(name gin_trgm_ops)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_albums_artist_name ON library_albums(artist, name)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS library_tracks (
            id SERIAL PRIMARY KEY,
            storage_id UUID,
            entity_uid UUID,
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
            audio_fingerprint TEXT,
            audio_fingerprint_source TEXT,
            audio_fingerprint_computed_at TIMESTAMPTZ,
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
            analysis_completed_at TIMESTAMPTZ,
            bliss_computed_at TIMESTAMPTZ,
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
                EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_tracks_storage_id ON library_tracks(storage_id) WHERE storage_id IS NOT NULL';
            END IF;
        END $$
    """)
    cur.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='library_tracks' AND column_name='entity_uid') THEN
                EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_tracks_entity_uid ON library_tracks(entity_uid)';
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

    cur.execute("""
        CREATE TABLE IF NOT EXISTS track_lyrics (
            id SERIAL PRIMARY KEY,
            provider TEXT NOT NULL DEFAULT 'lrclib',
            artist_key TEXT NOT NULL,
            title_key TEXT NOT NULL,
            artist TEXT NOT NULL,
            title TEXT NOT NULL,
            track_id INTEGER REFERENCES library_tracks(id) ON DELETE SET NULL,
            track_entity_uid UUID,
            synced_lyrics TEXT,
            plain_lyrics TEXT,
            found BOOLEAN NOT NULL DEFAULT TRUE,
            source_json JSONB DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    cur.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_track_lyrics_lookup
        ON track_lyrics(provider, artist_key, title_key)
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_track_lyrics_track ON track_lyrics(track_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_track_lyrics_entity ON track_lyrics(track_entity_uid)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_track_lyrics_updated ON track_lyrics(updated_at DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS album_portable_metadata (
            album_id INTEGER PRIMARY KEY REFERENCES library_albums(id) ON DELETE CASCADE,
            album_entity_uid UUID,
            sidecar_path TEXT,
            sidecar_written_at TIMESTAMPTZ,
            audio_tags_written_at TIMESTAMPTZ,
            tracks INTEGER NOT NULL DEFAULT 0,
            tags_written INTEGER NOT NULL DEFAULT 0,
            tag_errors INTEGER NOT NULL DEFAULT 0,
            export_path TEXT,
            exported_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_album_portable_metadata_sidecar ON album_portable_metadata(sidecar_written_at DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_album_portable_metadata_tags ON album_portable_metadata(audio_tags_written_at DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_album_portable_metadata_export ON album_portable_metadata(exported_at DESC)")


__all__ = ["create_library_catalog_schema"]
