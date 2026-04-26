from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def _serialize_popularity_row(row: dict) -> dict:
    popularity_score = row.get("popularity_score")
    popularity = row.get("popularity")
    listeners = row.get("listeners") or 0
    return {
        "artist": row["name"],
        "popularity": popularity if popularity is not None else min(100, listeners // 10000),
        "popularity_score": round(popularity_score, 4) if popularity_score is not None else None,
        "listeners": listeners,
        "albums": row.get("albums") or 0,
    }


def get_insights_popularity(limit: int = 20) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    la.name,
                    la.popularity,
                    la.popularity_score,
                    la.listeners,
                    COUNT(DISTINCT alb.id) AS albums
                FROM library_artists la
                LEFT JOIN library_albums alb ON alb.artist = la.name
                WHERE (la.popularity_score IS NOT NULL AND la.popularity_score > 0)
                   OR (la.popularity IS NOT NULL AND la.popularity > 0)
                   OR (la.listeners IS NOT NULL AND la.listeners > 0)
                GROUP BY la.id, la.name, la.popularity, la.popularity_score, la.listeners
                ORDER BY la.popularity_score DESC NULLS LAST, la.popularity DESC NULLS LAST, la.listeners DESC NULLS LAST
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
    return [_serialize_popularity_row(row) for row in rows]


def get_insights_artist_depth(limit: int = 120) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    la.name,
                    la.popularity,
                    la.popularity_score,
                    la.listeners,
                    COUNT(DISTINCT alb.id) AS albums,
                    COUNT(DISTINCT t.id) AS tracks
                FROM library_artists la
                LEFT JOIN library_albums alb ON alb.artist = la.name
                LEFT JOIN library_tracks t ON t.album_id = alb.id
                GROUP BY la.id, la.name, la.popularity, la.popularity_score, la.listeners
                HAVING COUNT(DISTINCT alb.id) > 0
                ORDER BY la.popularity_score DESC NULLS LAST, la.popularity DESC NULLS LAST, la.listeners DESC NULLS LAST
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()

    results: list[dict] = []
    for row in rows:
        payload = _serialize_popularity_row(row)
        payload["tracks"] = row.get("tracks") or 0
        results.append(payload)
    return results


__all__ = [
    "get_insights_artist_depth",
    "get_insights_popularity",
]
