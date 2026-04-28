from sqlalchemy import text

from crate.db.tx import transaction_scope


def get_similar_artists(artist_name: str, limit: int = 30) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT similar_name, score, source, in_library
                FROM artist_similarities
                WHERE artist_name = :artist_name
                ORDER BY score DESC
                LIMIT :lim
                """
            ),
            {"artist_name": artist_name, "lim": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


__all__ = [
    "get_similar_artists",
]
