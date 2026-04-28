from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import transaction_scope


_UPSERT_SIMILARITY_SQL = text(
    """
    INSERT INTO artist_similarities (artist_name, similar_name, score, source, updated_at)
    VALUES (:artist_name, :similar_name, :score, :source, :updated_at)
    ON CONFLICT (artist_name, similar_name) DO UPDATE SET
        score = EXCLUDED.score,
        source = EXCLUDED.source,
        updated_at = EXCLUDED.updated_at
    """
)


def upsert_similarity(artist_name: str, similar_name: str, score: float, source: str = "lastfm") -> None:
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        session.execute(
            _UPSERT_SIMILARITY_SQL,
            {
                "artist_name": artist_name,
                "similar_name": similar_name,
                "score": score,
                "source": source,
                "updated_at": now,
            },
        )


def bulk_upsert_similarities(artist_name: str, similarities: list[dict]) -> None:
    """Batch upsert similar artists for a given artist.

    Each dict in similarities must have 'name' and optionally 'score' and 'source'.
    """
    if not similarities:
        return
    now = datetime.now(timezone.utc).isoformat()
    rows = [
        {
            "artist_name": artist_name,
            "similar_name": similarity["name"],
            "score": float(similarity.get("score") or similarity.get("match") or 0.0),
            "source": similarity.get("source", "lastfm"),
            "updated_at": now,
        }
        for similarity in similarities
        if similarity.get("name")
    ]
    if not rows:
        return
    with transaction_scope() as session:
        session.execute(_UPSERT_SIMILARITY_SQL, rows)


def mark_library_status() -> int:
    """Update in_library flag based on current library_artists table. Returns updated row count."""
    with transaction_scope() as session:
        result = session.execute(
            text(
                """
                UPDATE artist_similarities
                SET in_library = EXISTS (
                    SELECT 1 FROM library_artists
                    WHERE LOWER(name) = LOWER(artist_similarities.similar_name)
                )
                """
            )
        )
        return result.rowcount


__all__ = [
    "bulk_upsert_similarities",
    "mark_library_status",
    "upsert_similarity",
]
