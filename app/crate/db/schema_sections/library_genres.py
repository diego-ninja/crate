"""Genre and taxonomy tables for the library schema bootstrap."""


def create_library_genres_schema(cur) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS genres (
            id SERIAL PRIMARY KEY,
            entity_uid UUID,
            name TEXT UNIQUE NOT NULL,
            slug TEXT UNIQUE NOT NULL
        )
    """)
    cur.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_genres_entity_uid ON genres(entity_uid) WHERE entity_uid IS NOT NULL"
    )
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
            entity_uid UUID,
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
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_genre_taxonomy_nodes_entity_uid ON genre_taxonomy_nodes(entity_uid) WHERE entity_uid IS NOT NULL"
    )
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_genre_taxonomy_nodes_musicbrainz_mbid
        ON genre_taxonomy_nodes(musicbrainz_mbid)
        WHERE musicbrainz_mbid IS NOT NULL
        """
    )


__all__ = ["create_library_genres_schema"]
