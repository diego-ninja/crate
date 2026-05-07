from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def _similarity_graph_from_rows(rows) -> dict[str, dict[str, float]]:
    graph: dict[str, dict[str, float]] = {}
    for row in rows:
        artist_name = row["artist_name"].lower()
        similar_name = row["similar_name"].lower()
        score = float(row["score"])
        graph.setdefault(artist_name, {})[similar_name] = score
        graph.setdefault(similar_name, {})[artist_name] = score
    return graph


def _member_graph_from_rows(rows) -> dict[str, set[str]]:
    member_to_bands: dict[str, list[str]] = {}
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


def _artist_genres_from_rows(rows) -> dict[str, dict[str, float]]:
    result: dict[str, dict[str, float]] = {}
    for row in rows:
        artist_name = row["artist_name"].lower()
        genre_name = row["name"].lower()
        result.setdefault(artist_name, {})[genre_name] = float(row["weight"])
    return result


def load_artist_similarity_graph() -> dict[str, dict[str, float]]:
    with read_scope() as session:
        rows = session.execute(
            text("SELECT artist_name, similar_name, score FROM artist_similarities")
        ).mappings().all()
    return _similarity_graph_from_rows(rows)


def load_shared_members_graph() -> dict[str, set[str]]:
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
    return _member_graph_from_rows(rows)


def load_artist_genres() -> dict[str, dict[str, float]]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT ag.artist_name, g.name, ag.weight
                FROM artist_genres ag JOIN genres g ON g.id = ag.genre_id
                """
            )
        ).mappings().all()
    return _artist_genres_from_rows(rows)


def load_artist_radio_graphs() -> tuple[dict[str, dict[str, float]], dict[str, dict[str, float]], dict[str, set[str]]]:
    with read_scope() as session:
        similarity_rows = session.execute(
            text("SELECT artist_name, similar_name, score FROM artist_similarities")
        ).mappings().all()
        genre_rows = session.execute(
            text(
                """
                SELECT ag.artist_name, g.name, ag.weight
                FROM artist_genres ag JOIN genres g ON g.id = ag.genre_id
                """
            )
        ).mappings().all()
        member_rows = session.execute(
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
    return (
        _similarity_graph_from_rows(similarity_rows),
        _artist_genres_from_rows(genre_rows),
        _member_graph_from_rows(member_rows),
    )


__all__ = [
    "load_artist_genres",
    "load_artist_radio_graphs",
    "load_artist_similarity_graph",
    "load_shared_members_graph",
]
