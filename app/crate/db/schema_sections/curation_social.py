"""Social graph and affinity schema bootstrap helpers."""


def create_curation_social_schema(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS user_relationships (
            follower_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            followed_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (follower_user_id, followed_user_id),
            CHECK (follower_user_id != followed_user_id)
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_relationships_followed ON user_relationships(followed_user_id, created_at DESC)")

    cur.execute(
        """
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
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_affinity_cache_score ON user_affinity_cache(affinity_score DESC, computed_at DESC)")


__all__ = [
    "create_curation_social_schema",
]
