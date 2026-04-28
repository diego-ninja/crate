from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_insights_energy_danceability(limit: int = 500) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT energy, danceability, artist, title
                FROM library_tracks
                WHERE energy IS NOT NULL AND danceability IS NOT NULL
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
    return [
        {"x": round(row["energy"], 2), "y": round(row["danceability"], 2), "artist": row["artist"], "title": row["title"]}
        for row in rows
    ]


def get_insights_acoustic_instrumental(limit: int = 500) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT acousticness, instrumentalness, artist, title
                FROM library_tracks
                WHERE acousticness IS NOT NULL AND instrumentalness IS NOT NULL
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
    return [
        {
            "x": round(row["acousticness"], 2),
            "y": round(row["instrumentalness"], 2),
            "artist": row["artist"],
            "title": row["title"],
        }
        for row in rows
    ]


__all__ = [
    "get_insights_acoustic_instrumental",
    "get_insights_energy_danceability",
]
