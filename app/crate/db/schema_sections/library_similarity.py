"""Similarity tables for the library schema bootstrap."""


def create_library_similarity_schema(cur) -> None:
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


__all__ = ["create_library_similarity_schema"]
