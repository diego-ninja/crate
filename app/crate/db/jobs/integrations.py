"""DB functions for integration worker handlers."""

from crate.db.core import get_db_ctx


def get_artists_with_similar_json() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("SELECT name, similar_json FROM library_artists WHERE similar_json IS NOT NULL")
        return cur.fetchall()
