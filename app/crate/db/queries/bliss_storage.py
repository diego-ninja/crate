from __future__ import annotations

from sqlalchemy import text

from crate.db.bliss_vectors import to_pgvector_literal
from crate.db.tx import transaction_scope


def store_bliss_vectors(vectors: dict[str, list[float]]):
    """Store bliss feature vectors in the database (only for tracks missing them)."""
    with transaction_scope() as session:
        for path, features in vectors.items():
            session.execute(
                text(
                    "UPDATE library_tracks "
                    "SET bliss_vector = :features, "
                    "    bliss_embedding = CAST(:vector_literal AS vector(20)) "
                    "WHERE path = :path AND bliss_vector IS NULL"
                ),
                {"features": features, "vector_literal": to_pgvector_literal(features), "path": path},
            )


__all__ = ["store_bliss_vectors"]
