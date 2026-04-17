"""DB functions for integration worker handlers."""

from crate.db.tx import transaction_scope
from sqlalchemy import text


def get_artists_with_similar_json() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT name, similar_json FROM library_artists WHERE similar_json IS NOT NULL")
        ).mappings().all()
        return [dict(row) for row in rows]
