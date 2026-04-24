"""Library and catalog schema bootstrap section."""


def create_library_schema(cur) -> None:
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
