from __future__ import annotations

from sqlalchemy import text

from crate.db.bliss_vectors import to_pgvector_literal
from crate.db.queries.paths_shared import array_distance_sql
from crate.db.tx import read_scope


def _normalize_track_row(row) -> dict | None:
    if not row:
        return None
    data = dict(row)
    if data.get("bliss_vector"):
        data["bliss_vector"] = list(data["bliss_vector"])
    return data


def find_anchor_track_row(
    endpoint_type: str,
    endpoint_value: str,
    target_vec: list[float],
    exclude: set[int],
) -> dict | None:
    probe_vector = to_pgvector_literal(target_vec)
    probe_array = list(target_vec)
    exclude_clause = "AND t.id != ALL(:exclude)" if exclude else ""
    params: dict = {"probe_vector": probe_vector, "probe_array": probe_array}
    if exclude:
        params["exclude"] = list(exclude)

    with read_scope() as session:
        if endpoint_type == "track":
            row = session.execute(
                text(
                    """
                    SELECT t.id, t.storage_id, t.title, a.artist, a.name AS album,
                           t.album_id, t.bliss_vector, 0.0 AS distance
                    FROM library_tracks t
                    JOIN library_albums a ON a.id = t.album_id
                    WHERE t.id = :track_id AND t.bliss_vector IS NOT NULL
                    """
                ),
                {"track_id": int(endpoint_value)},
            ).mappings().first()
            return _normalize_track_row(row)

        if endpoint_type == "artist":
            scope_clause = "AND a.artist = (SELECT name FROM library_artists WHERE id = :scope_id)"
            params["scope_id"] = int(endpoint_value)
        elif endpoint_type == "album":
            scope_clause = "AND t.album_id = :scope_id"
            params["scope_id"] = int(endpoint_value)
        elif endpoint_type == "genre":
            scope_clause = """AND a.artist IN (
                SELECT ag.artist_name FROM artist_genres ag
                JOIN genres g ON g.id = ag.genre_id
                WHERE g.slug = :scope_slug
            )"""
            params["scope_slug"] = endpoint_value
        else:
            scope_clause = ""

        row = session.execute(
            text(
                f"""
                SELECT t.id, t.storage_id, t.title, a.artist, a.name AS album,
                       t.album_id, t.bliss_vector,
                       (t.bliss_embedding <-> CAST(:probe_vector AS vector(20))) AS distance
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                WHERE t.bliss_embedding IS NOT NULL
                {scope_clause}
                {exclude_clause}
                ORDER BY t.bliss_embedding <-> CAST(:probe_vector AS vector(20))
                LIMIT 1
                """
            ),
            params,
        ).mappings().first()

        if not row:
            fallback_distance = array_distance_sql("t.bliss_vector")
            row = session.execute(
                text(
                    f"""
                    SELECT t.id, t.storage_id, t.title, a.artist, a.name AS album,
                           t.album_id, t.bliss_vector,
                           {fallback_distance} AS distance
                    FROM library_tracks t
                    JOIN library_albums a ON a.id = t.album_id
                    WHERE t.bliss_vector IS NOT NULL
                    {scope_clause}
                    {exclude_clause}
                    ORDER BY {fallback_distance}
                    LIMIT 1
                    """
                ),
                params,
            ).mappings().first()

    return _normalize_track_row(row)


def find_candidate_rows(
    target: list[float],
    exclude_ids: set[int],
    *,
    limit: int,
) -> list[dict]:
    probe_vector = to_pgvector_literal(target)
    probe_array = list(target)

    exclude_clause = ""
    params: dict = {"probe_vector": probe_vector, "probe_array": probe_array}
    if exclude_ids:
        exclude_clause = "AND t.id != ALL(:exclude)"
        params["exclude"] = list(exclude_ids)

    with read_scope() as session:
        rows = session.execute(
            text(
                f"""
                SELECT t.id, t.storage_id, t.title, a.artist,
                       a.name AS album, t.album_id, t.bliss_vector,
                       (t.bliss_embedding <-> CAST(:probe_vector AS vector(20))) AS distance
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                WHERE t.bliss_embedding IS NOT NULL
                {exclude_clause}
                ORDER BY t.bliss_embedding <-> CAST(:probe_vector AS vector(20))
                LIMIT {int(limit)}
                """
            ),
            params,
        ).mappings().all()

        if not rows:
            fallback_distance = array_distance_sql("t.bliss_vector")
            rows = session.execute(
                text(
                    f"""
                    SELECT t.id, t.storage_id, t.title, a.artist,
                           a.name AS album, t.album_id, t.bliss_vector,
                           {fallback_distance} AS distance
                    FROM library_tracks t
                    JOIN library_albums a ON a.id = t.album_id
                    WHERE t.bliss_vector IS NOT NULL
                    {exclude_clause}
                    ORDER BY {fallback_distance}
                    LIMIT {int(limit)}
                    """
                ),
                params,
            ).mappings().all()

    return [_normalize_track_row(row) for row in rows]


__all__ = [
    "find_anchor_track_row",
    "find_candidate_rows",
]
