"""Read-only queries for music path planning and retrieval."""

from sqlalchemy import text

from crate.db.bliss_vectors import to_pgvector_literal
from crate.db.tx import read_scope


def _array_distance_sql(vector_expr: str) -> str:
    return f"""
        SQRT(COALESCE((
            SELECT SUM(POWER(tv.val - pv.val, 2))
            FROM UNNEST({vector_expr}) WITH ORDINALITY AS tv(val, idx)
            JOIN UNNEST(CAST(:probe_array AS double precision[])) WITH ORDINALITY AS pv(val, idx)
              USING (idx)
        ), 0.0))
    """


def fetch_bliss_vectors_for_endpoint(endpoint_type: str, value: str) -> list[list[float]]:
    with read_scope() as session:
        if endpoint_type == "track":
            row = session.execute(
                text("SELECT bliss_vector FROM library_tracks WHERE id = :id AND bliss_vector IS NOT NULL"),
                {"id": int(value)},
            ).mappings().first()
            return [list(row["bliss_vector"])] if row else []

        if endpoint_type == "album":
            rows = session.execute(
                text(
                    """
                    SELECT bliss_vector FROM library_tracks
                    WHERE album_id = :id AND bliss_vector IS NOT NULL
                    """
                ),
                {"id": int(value)},
            ).mappings().all()
            return [list(r["bliss_vector"]) for r in rows]

        if endpoint_type == "artist":
            rows = session.execute(
                text(
                    """
                    SELECT t.bliss_vector
                    FROM library_tracks t
                    JOIN library_albums a ON a.id = t.album_id
                    WHERE a.artist = (
                        SELECT name FROM library_artists WHERE id = :id
                    )
                    AND t.bliss_vector IS NOT NULL
                    LIMIT 20
                    """
                ),
                {"id": int(value)},
            ).mappings().all()
            return [list(r["bliss_vector"]) for r in rows]

        if endpoint_type == "genre":
            rows = session.execute(
                text(
                    """
                    SELECT t.bliss_vector
                    FROM library_tracks t
                    JOIN library_albums a ON a.id = t.album_id
                    JOIN artist_genres ag ON ag.artist_name = a.artist
                    JOIN genres g ON g.id = ag.genre_id
                    WHERE g.slug = :slug AND t.bliss_vector IS NOT NULL
                    ORDER BY ag.weight DESC
                    LIMIT 30
                    """
                ),
                {"slug": value},
            ).mappings().all()
            return [list(r["bliss_vector"]) for r in rows]

    return []


def resolve_endpoint_label(endpoint_type: str, value: str) -> str:
    with read_scope() as session:
        if endpoint_type == "track":
            row = session.execute(
                text("SELECT title, artist FROM library_tracks WHERE id = :id"),
                {"id": int(value)},
            ).mappings().first()
            return f"{row['title']} — {row['artist']}" if row else value

        if endpoint_type == "album":
            row = session.execute(
                text("SELECT name, artist FROM library_albums WHERE id = :id"),
                {"id": int(value)},
            ).mappings().first()
            return f"{row['name']} — {row['artist']}" if row else value

        if endpoint_type == "artist":
            row = session.execute(
                text("SELECT name FROM library_artists WHERE id = :id"),
                {"id": int(value)},
            ).mappings().first()
            return row["name"] if row else value

        if endpoint_type == "genre":
            row = session.execute(
                text("SELECT name FROM genres WHERE slug = :slug"),
                {"slug": value},
            ).mappings().first()
            return row["name"] if row else value

    return value


def load_artist_similarity_graph() -> dict[str, dict[str, float]]:
    graph: dict[str, dict[str, float]] = {}
    with read_scope() as session:
        rows = session.execute(
            text("SELECT artist_name, similar_name, score FROM artist_similarities")
        ).mappings().all()
    for r in rows:
        a = r["artist_name"].lower()
        s = r["similar_name"].lower()
        score = float(r["score"])
        graph.setdefault(a, {})[s] = score
        graph.setdefault(s, {})[a] = score
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
    for r in rows:
        member = r["member"].lower().strip()
        artist = r["artist"].lower().strip()
        member_to_bands.setdefault(member, []).append(artist)

    graph: dict[str, set[str]] = {}
    for bands in member_to_bands.values():
        if len(bands) < 2:
            continue
        for i, a in enumerate(bands):
            for b in bands[i + 1:]:
                if a != b:
                    graph.setdefault(a, set()).add(b)
                    graph.setdefault(b, set()).add(a)
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
    for r in rows:
        a = r["artist_name"].lower()
        g = r["name"].lower()
        result.setdefault(a, {})[g] = float(r["weight"])
    return result


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
            if row:
                d = dict(row)
                d["bliss_vector"] = list(d["bliss_vector"]) if d.get("bliss_vector") else None
                return d
            return None

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
            fallback_distance = _array_distance_sql("t.bliss_vector")
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

    if not row:
        return None
    d = dict(row)
    d["bliss_vector"] = list(d["bliss_vector"]) if d.get("bliss_vector") else None
    return d


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
            fallback_distance = _array_distance_sql("t.bliss_vector")
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

    return [dict(row) for row in rows]


def get_music_path_row(path_id: int, user_id: int) -> dict | None:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT id, name, origin_type, origin_value, origin_label,
                       dest_type, dest_value, dest_label, waypoints, step_count,
                       tracks, created_at, updated_at
                FROM music_paths
                WHERE id = :id AND user_id = :user_id
                """
            ),
            {"id": path_id, "user_id": user_id},
        ).mappings().first()
    return dict(row) if row else None


def list_music_path_rows(user_id: int) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT id, name, origin_type, origin_value, origin_label,
                       dest_type, dest_value, dest_label, waypoints, step_count,
                       jsonb_array_length(tracks) AS track_count,
                       created_at, updated_at
                FROM music_paths
                WHERE user_id = :user_id
                ORDER BY created_at DESC
                """
            ),
            {"user_id": user_id},
        ).mappings().all()
    return [dict(row) for row in rows]


__all__ = [
    "fetch_bliss_vectors_for_endpoint",
    "find_anchor_track_row",
    "find_candidate_rows",
    "get_music_path_row",
    "list_music_path_rows",
    "load_artist_genres",
    "load_artist_similarity_graph",
    "load_shared_members_graph",
    "resolve_endpoint_label",
]
