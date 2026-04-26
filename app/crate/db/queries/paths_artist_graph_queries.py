from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def load_artist_similarity_graph() -> dict[str, dict[str, float]]:
    graph: dict[str, dict[str, float]] = {}
    with read_scope() as session:
        rows = session.execute(
            text("SELECT artist_name, similar_name, score FROM artist_similarities")
        ).mappings().all()
    for row in rows:
        artist_name = row["artist_name"].lower()
        similar_name = row["similar_name"].lower()
        score = float(row["score"])
        graph.setdefault(artist_name, {})[similar_name] = score
        graph.setdefault(similar_name, {})[artist_name] = score
    return graph


def load_shared_members_graph() -> dict[str, set[str]]:
    member_to_bands: dict[str, list[str]] = {}
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT a.name AS artist, m->>'name' AS member
                FROM library_artists a, jsonb_array_elements(a.members_json) AS m
                WHERE a.members_json IS NOT NULL
                  AND a.members_json != 'null'
                  AND a.members_json != '[]'
                """
            )
        ).mappings().all()
    for row in rows:
        member = row["member"].lower().strip()
        artist = row["artist"].lower().strip()
        member_to_bands.setdefault(member, []).append(artist)

    graph: dict[str, set[str]] = {}
    for bands in member_to_bands.values():
        if len(bands) < 2:
            continue
        for index, left in enumerate(bands):
            for right in bands[index + 1 :]:
                if left != right:
                    graph.setdefault(left, set()).add(right)
                    graph.setdefault(right, set()).add(left)
    return graph


def load_artist_genres() -> dict[str, dict[str, float]]:
    result: dict[str, dict[str, float]] = {}
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT ag.artist_name, g.name, ag.weight
                FROM artist_genres ag JOIN genres g ON g.id = ag.genre_id
                """
            )
        ).mappings().all()
    for row in rows:
        artist_name = row["artist_name"].lower()
        genre_name = row["name"].lower()
        result.setdefault(artist_name, {})[genre_name] = float(row["weight"])
    return result


__all__ = [
    "load_artist_genres",
    "load_artist_similarity_graph",
    "load_shared_members_graph",
]
