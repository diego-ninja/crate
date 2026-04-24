from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_recent_global_artist_rows(limit: int = 10) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    la.id,
                    la.slug,
                    la.name,
                    la.album_count,
                    la.track_count,
                    la.has_photo
                FROM library_artists la
                ORDER BY COALESCE(la.dir_mtime, EXTRACT(EPOCH FROM la.updated_at)::bigint) DESC, la.name ASC
                LIMIT :limit
                """
            ),
            {"limit": max(limit, 1)},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_home_hero_rows(
    *,
    followed_names_lower: list[str],
    similar_target_names_lower: list[str],
    top_genres_lower: list[str],
) -> list[dict]:
    with read_scope() as session:
        rows_result = session.execute(
            text(
                """
                SELECT
                    la.id,
                    la.slug,
                    la.name,
                    COALESCE(la.listeners, 0) AS listeners,
                    COALESCE(la.lastfm_playcount, 0) AS scrobbles,
                    COALESCE(la.album_count, 0) AS album_count,
                    COALESCE(la.track_count, 0) AS track_count,
                    COALESCE(la.bio, '') AS bio,
                    COUNT(DISTINCT CASE WHEN LOWER(g.name) = ANY(:top_genres) THEN g.name END) AS genre_hits,
                    MAX(CASE WHEN LOWER(sim.similar_name) = ANY(:similar_targets) THEN 1 ELSE 0 END) AS similar_hits
                FROM library_artists la
                LEFT JOIN artist_genres ag ON ag.artist_name = la.name
                LEFT JOIN genres g ON g.id = ag.genre_id
                LEFT JOIN artist_similarities sim ON sim.artist_name = la.name AND sim.in_library = TRUE
                WHERE la.has_photo = 1
                  AND COALESCE(la.bio, '') <> ''
                  AND NOT (LOWER(la.name) = ANY(:followed))
                GROUP BY la.id, la.slug, la.name, la.listeners, la.lastfm_playcount, la.album_count, la.track_count, la.bio
                HAVING COUNT(DISTINCT CASE WHEN LOWER(g.name) = ANY(:top_genres) THEN g.name END) > 0
                ORDER BY
                    MAX(CASE WHEN LOWER(sim.similar_name) = ANY(:similar_targets) THEN 1 ELSE 0 END) DESC,
                    COUNT(DISTINCT CASE WHEN LOWER(g.name) = ANY(:top_genres) THEN g.name END) DESC,
                    COALESCE(la.listeners, 0) DESC,
                    COALESCE(la.lastfm_playcount, 0) DESC
                LIMIT 7
                """
            ),
            {
                "top_genres": top_genres_lower,
                "similar_targets": similar_target_names_lower,
                "followed": followed_names_lower,
            },
        ).mappings().all()

        if not rows_result:
            rows_result = session.execute(
                text(
                    """
                    SELECT
                        id,
                        slug,
                        name,
                        COALESCE(listeners, 0) AS listeners,
                        COALESCE(lastfm_playcount, 0) AS scrobbles,
                        COALESCE(album_count, 0) AS album_count,
                        COALESCE(track_count, 0) AS track_count,
                        COALESCE(bio, '') AS bio
                    FROM library_artists
                    WHERE has_photo = 1
                      AND COALESCE(bio, '') <> ''
                      AND NOT (LOWER(name) = ANY(:followed))
                    ORDER BY COALESCE(listeners, 0) DESC, COALESCE(lastfm_playcount, 0) DESC
                    LIMIT 7
                    """
                ),
                {"followed": followed_names_lower},
            ).mappings().all()

    return [dict(item) for item in rows_result]


def get_artist_genres_map(artist_names: list[str]) -> dict[str, list[str]]:
    if not artist_names:
        return {}
    with read_scope() as session:
        genre_rows = session.execute(
            text(
                """
                SELECT ag.artist_name, g.name
                FROM artist_genres ag
                JOIN genres g ON g.id = ag.genre_id
                WHERE ag.artist_name = ANY(:names)
                ORDER BY ag.artist_name
                """
            ),
            {"names": artist_names},
        ).mappings().all()

    genre_map: dict[str, list[str]] = {}
    for row in genre_rows:
        genre_map.setdefault(row["artist_name"], []).append(row["name"])
    return genre_map


def get_library_artist_by_id(artist_id: int) -> dict | None:
    with read_scope() as session:
        row = session.execute(
            text("SELECT id, slug, name FROM library_artists WHERE id = :id"),
            {"id": artist_id},
        ).mappings().first()
    return dict(row) if row else None


def get_followed_artist_genre_names(names: list[str], limit: int) -> list[str]:
    if not names:
        return []
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT g.name, COUNT(*) AS cnt
                FROM artist_genres ag
                JOIN genres g ON g.id = ag.genre_id
                WHERE LOWER(ag.artist_name) = ANY(:names)
                GROUP BY g.name
                ORDER BY cnt DESC
                LIMIT :lim
                """
            ),
            {"names": names, "lim": limit},
        ).mappings().all()
    return [row["name"].lower() for row in rows]


__all__ = [
    "get_artist_genres_map",
    "get_followed_artist_genre_names",
    "get_home_hero_rows",
    "get_library_artist_by_id",
    "get_recent_global_artist_rows",
]
