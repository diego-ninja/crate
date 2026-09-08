from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_recent_global_artist_rows(limit: int = 10) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT
                    la.id,
                    la.slug,
                    la.name,
                    la.album_count,
                    la.track_count,
                    la.has_photo,
                    COALESCE(
                        MIN(
                            COALESCE(
                                alb.dir_mtime,
                                EXTRACT(EPOCH FROM alb.updated_at)::double precision
                            )
                        ),
                        COALESCE(
                            la.dir_mtime,
                            EXTRACT(EPOCH FROM la.updated_at)::double precision
                        ),
                        0
                    ) AS first_added_sort
                FROM library_artists la
                LEFT JOIN library_albums alb ON alb.artist = la.name
                WHERE la.name NOT LIKE '.%'
                  AND COALESCE(la.folder_name, '') NOT LIKE '.%'
                GROUP BY
                    la.id,
                    la.slug,
                    la.name,
                    la.album_count,
                    la.track_count,
                    la.has_photo,
                    la.dir_mtime,
                    la.updated_at
                ORDER BY first_added_sort DESC, la.name ASC
                LIMIT :limit
                """
                ),
                {"limit": max(limit, 1)},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_home_hero_rows(
    *,
    user_id: int | None = None,
    followed_names_lower: list[str],
    similar_target_names_lower: list[str],
    top_genres_lower: list[str],
    limit: int = 40,
) -> list[dict]:
    _ = (
        user_id,
        followed_names_lower,
        similar_target_names_lower,
        top_genres_lower,
    )
    row_limit = min(max(limit, 1), 40)
    candidate_limit = max(30, row_limit * 3)
    with read_scope() as session:
        rows_result = (
            session.execute(
                text(
                    """
                WITH recent AS (
                    SELECT
                        la.id,
                        la.entity_uid,
                        la.slug,
                        la.name,
                        COALESCE(la.listeners, 0) AS listeners,
                        COALESCE(la.lastfm_playcount, 0) AS scrobbles,
                        COALESCE(la.album_count, 0) AS album_count,
                        COALESCE(la.track_count, 0) AS track_count,
                        COALESCE(la.bio, '') AS bio,
                        la.is_featured,
                        COALESCE(
                            MIN(
                                COALESCE(
                                    alb.dir_mtime,
                                    EXTRACT(EPOCH FROM alb.updated_at)::double precision
                                )
                            ),
                            COALESCE(
                                la.dir_mtime,
                                EXTRACT(EPOCH FROM la.updated_at)::double precision
                            ),
                            0
                        ) AS first_added_sort
                    FROM library_artists la
                    LEFT JOIN library_albums alb ON alb.artist = la.name
                    LEFT JOIN artist_hero_artwork candidate_hero
                      ON candidate_hero.artist_id = la.id
                    WHERE (
                        la.has_photo = 1
                        OR (
                            candidate_hero.artist_id IS NOT NULL
                            AND candidate_hero.review_status <> 'rejected'
                        )
                    )
                      AND la.name NOT LIKE '.%'
                      AND COALESCE(la.folder_name, '') NOT LIKE '.%'
                    GROUP BY
                        la.id, la.entity_uid, la.slug, la.name, la.listeners,
                        la.lastfm_playcount, la.album_count, la.track_count,
                        la.bio, la.is_featured, la.dir_mtime, la.updated_at,
                        candidate_hero.provenance,
                        candidate_hero.review_status
                    ORDER BY
                        CASE
                            WHEN candidate_hero.provenance = 'manual'
                             AND candidate_hero.review_status = 'approved' THEN 0
                            WHEN candidate_hero.provenance = 'derived_background'
                             AND candidate_hero.review_status <> 'rejected' THEN 1
                            ELSE 2
                        END,
                        first_added_sort DESC,
                        la.name ASC
                    LIMIT :candidate_limit
                )
                SELECT
                    recent.*,
                    COALESCE(user_stats.play_count, 0) AS user_play_count,
                    COALESCE(user_stats.complete_play_count, 0) AS user_complete_play_count,
                    COALESCE(user_stats.minutes_listened, 0) AS user_minutes_listened,
                    user_stats.last_played_at AS user_last_played_at,
                    CASE
                        WHEN LOWER(recent.name) = ANY(:followed_names_lower)
                        THEN TRUE
                        ELSE FALSE
                    END AS is_followed,
                    CASE
                        WHEN LOWER(recent.name) = ANY(:similar_target_names_lower)
                        THEN 1
                        ELSE 0
                    END AS similar_hits,
                    COALESCE(genre_matches.genre_hits, 0) AS genre_hits,
                    COALESCE(recent_exposure.recent_exposure_count, 0)
                        AS recent_exposure_count,
                    CASE
                        WHEN hero.provenance = 'manual'
                         AND hero.review_status = 'approved' THEN 'specific'
                        WHEN hero.provenance = 'derived_background'
                         AND hero.review_status <> 'rejected' THEN 'derived'
                        ELSE 'fallback'
                    END AS artwork_provenance,
                    hero.revision AS artwork_revision,
                    hero.source_width AS _hero_source_width,
                    hero.source_height AS _hero_source_height,
                    hero.desktop_source_width AS _hero_desktop_source_width,
                    hero.desktop_source_height AS _hero_desktop_source_height,
                    hero.mobile_source_width AS _hero_mobile_source_width,
                    hero.mobile_source_height AS _hero_mobile_source_height,
                    hero.desktop_recipe AS _hero_desktop_recipe,
                    hero.mobile_recipe AS _hero_mobile_recipe,
                    hero.desktop_enabled AS _hero_desktop_enabled,
                    hero.mobile_enabled AS _hero_mobile_enabled,
                    hero.provenance AS _hero_provenance,
                    hero.review_status AS _hero_review_status
                FROM recent
                LEFT JOIN artist_hero_artwork hero ON hero.artist_id = recent.id
                LEFT JOIN user_artist_stats user_stats
                  ON user_stats.user_id = :user_id
                 AND user_stats.stat_window = '90d'
                 AND LOWER(user_stats.artist_name) = LOWER(recent.name)
                LEFT JOIN LATERAL (
                    SELECT COUNT(*)::integer AS genre_hits
                    FROM artist_genres ag
                    JOIN genres g ON g.id = ag.genre_id
                    WHERE LOWER(ag.artist_name) = LOWER(recent.name)
                      AND LOWER(g.name) = ANY(:top_genres_lower)
                ) genre_matches ON TRUE
                LEFT JOIN LATERAL (
                    SELECT COUNT(*)::integer AS recent_exposure_count
                    FROM user_play_events upe
                    WHERE upe.user_id = :user_id
                      AND LOWER(COALESCE(upe.artist, '')) = LOWER(recent.name)
                      AND upe.ended_at >= NOW() - INTERVAL '14 days'
                ) recent_exposure ON TRUE
                ORDER BY
                    CASE
                        WHEN hero.provenance = 'manual'
                         AND hero.review_status = 'approved' THEN 0
                        WHEN hero.provenance = 'derived_background'
                         AND hero.review_status <> 'rejected' THEN 1
                        ELSE 2
                    END,
                    recent.first_added_sort DESC,
                    recent.name ASC
                LIMIT :limit
                """
                ),
                {
                    "limit": row_limit,
                    "candidate_limit": candidate_limit,
                    "user_id": user_id,
                    "followed_names_lower": followed_names_lower,
                    "similar_target_names_lower": similar_target_names_lower,
                    "top_genres_lower": top_genres_lower,
                },
            )
            .mappings()
            .all()
        )

    return [dict(item) for item in rows_result]


def get_artist_genres_map(artist_names: list[str]) -> dict[str, list[str]]:
    if not artist_names:
        return {}
    with read_scope() as session:
        genre_rows = (
            session.execute(
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
            )
            .mappings()
            .all()
        )

    genre_map: dict[str, list[str]] = {}
    for row in genre_rows:
        genre_map.setdefault(row["artist_name"], []).append(row["name"])
    return genre_map


def get_artist_genre_profiles_map(
    artist_names: list[str], limit: int = 4
) -> dict[str, list[dict]]:
    """Return the top weighted genres for each artist in one read query."""

    if not artist_names:
        return {}

    profile_limit = max(limit, 1)
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    WITH ranked AS (
                        SELECT
                            ag.artist_name,
                            g.name,
                            g.slug,
                            ag.weight,
                            ag.source,
                            ROW_NUMBER() OVER (
                                PARTITION BY ag.artist_name
                                ORDER BY ag.weight DESC NULLS LAST, g.name ASC
                            ) AS genre_rank
                        FROM artist_genres ag
                        JOIN genres g ON g.id = ag.genre_id
                        WHERE ag.artist_name = ANY(:names)
                    )
                    SELECT artist_name, name, slug, weight, source
                    FROM ranked
                    WHERE genre_rank <= :limit
                    ORDER BY artist_name, weight DESC NULLS LAST, name ASC
                    """
                ),
                {"names": artist_names, "limit": profile_limit},
            )
            .mappings()
            .all()
        )

    rows_by_artist: dict[str, list[dict]] = {}
    for row in rows:
        rows_by_artist.setdefault(row["artist_name"], []).append(dict(row))

    profiles: dict[str, list[dict]] = {}
    for artist_name, artist_rows in rows_by_artist.items():
        weights = [
            float(row["weight"])
            for row in artist_rows
            if row.get("weight") is not None and float(row["weight"]) > 0
        ]
        total_weight = sum(weights)
        max_weight = max(weights, default=0.0)
        artist_profiles: list[dict] = []
        for row in artist_rows:
            weight = row.get("weight")
            numeric_weight = float(weight) if weight is not None else 0.0
            share = numeric_weight / total_weight if total_weight else 0.0
            percent = round(numeric_weight / max_weight * 100) if max_weight else None
            if percent is not None and numeric_weight > 0:
                percent = max(percent, 1)
            artist_profiles.append(
                {
                    "name": row["name"],
                    "slug": row.get("slug"),
                    "source": row.get("source"),
                    "weight": round(numeric_weight, 4),
                    "share": round(share, 4),
                    "percent": percent,
                }
            )
        profiles[artist_name] = artist_profiles

    return profiles


def get_library_artist_by_id(artist_id: int) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text("SELECT id, slug, name FROM library_artists WHERE id = :id"),
                {"id": artist_id},
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None


def get_followed_artist_genre_names(names: list[str], limit: int) -> list[str]:
    if not names:
        return []
    with read_scope() as session:
        rows = (
            session.execute(
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
            )
            .mappings()
            .all()
        )
    return [row["name"].lower() for row in rows]


__all__ = [
    "get_artist_genres_map",
    "get_artist_genre_profiles_map",
    "get_followed_artist_genre_names",
    "get_home_hero_rows",
    "get_library_artist_by_id",
    "get_recent_global_artist_rows",
]
