"""Favorites schema bootstrap helpers."""


def create_favorites_schema(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS favorites (
            id SERIAL PRIMARY KEY,
            item_type TEXT NOT NULL,
            item_id TEXT NOT NULL,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL,
            UNIQUE(item_type, item_id)
        )
        """
    )


__all__ = [
    "create_favorites_schema",
]
