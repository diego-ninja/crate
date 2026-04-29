from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.genres_shared import annotate_genre_mapping
from crate.db.tx import read_scope


def get_all_genres() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    g.id,
                    g.entity_uid::text AS entity_uid,
                    g.name,
                    g.slug,
                    COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
                    COUNT(DISTINCT alg.album_id)::INTEGER AS album_count,
                    tn.slug AS canonical_slug,
                    tn.name AS canonical_name,
                    tn.description AS canonical_description,
                    tn.external_description,
                    tn.external_description_source,
                    tn.musicbrainz_mbid,
                    tn.wikidata_entity_id,
                    tn.wikidata_url
                FROM genres g
                LEFT JOIN artist_genres ag ON g.id = ag.genre_id
                LEFT JOIN album_genres alg ON g.id = alg.genre_id
                LEFT JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
                LEFT JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
                GROUP BY
                    g.id,
                    g.entity_uid,
                    g.name,
                    g.slug,
                    tn.slug,
                    tn.name,
                    tn.description,
                    tn.external_description,
                    tn.external_description_source,
                    tn.musicbrainz_mbid,
                    tn.wikidata_entity_id,
                    tn.wikidata_url
                HAVING COUNT(DISTINCT ag.artist_name) > 0 OR COUNT(DISTINCT alg.album_id) > 0
                ORDER BY COUNT(DISTINCT ag.artist_name) DESC
                """
            )
        ).mappings().all()
        return annotate_genre_mapping([dict(r) for r in rows])


def get_unmapped_genres(limit: int = 24) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    g.id,
                    g.entity_uid::text AS entity_uid,
                    g.name,
                    g.slug,
                    COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
                    COUNT(DISTINCT alg.album_id)::INTEGER AS album_count
                FROM genres g
                LEFT JOIN artist_genres ag ON g.id = ag.genre_id
                LEFT JOIN album_genres alg ON g.id = alg.genre_id
                LEFT JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
                WHERE gta.alias_slug IS NULL
                  AND NOT EXISTS (
                      SELECT 1
                      FROM genre_taxonomy_aliases gta_name
                      WHERE LOWER(TRIM(gta_name.alias_name)) = LOWER(TRIM(g.name))
                  )
                GROUP BY g.id, g.entity_uid, g.name, g.slug
                HAVING COUNT(DISTINCT ag.artist_name) > 0 OR COUNT(DISTINCT alg.album_id) > 0
                ORDER BY COUNT(DISTINCT ag.artist_name) DESC, COUNT(DISTINCT alg.album_id) DESC, g.name ASC
                LIMIT :lim
                """
            ),
            {"lim": limit},
        ).mappings().all()
    items = [dict(row) for row in rows]
    for item in items:
        item["mapped"] = False
        item["canonical_slug"] = None
        item["canonical_name"] = None
        item["canonical_description"] = None
        item["top_level_slug"] = None
        item["top_level_name"] = None
        item["top_level_description"] = None
        item["description"] = None
        item["external_description"] = None
        item["external_description_source"] = None
        item["musicbrainz_mbid"] = None
        item["wikidata_entity_id"] = None
        item["wikidata_url"] = None
    return items


def get_total_genre_count() -> int:
    with read_scope() as session:
        row = session.execute(text("SELECT COUNT(*) as cnt FROM genres")).mappings().first()
    return int(row["cnt"]) if row else 0


def list_unmapped_genres_for_inference(limit: int, focus_slug: str | None = None) -> list[dict]:
    with read_scope() as session:
        items: list[dict] = []
        if focus_slug:
            row = session.execute(
                text(
                    """
                    SELECT
                        g.id,
                        g.entity_uid::text AS entity_uid,
                        g.name,
                        g.slug,
                        COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
                        COUNT(DISTINCT alg.album_id)::INTEGER AS album_count
                    FROM genres g
                    LEFT JOIN artist_genres ag ON g.id = ag.genre_id
                    LEFT JOIN album_genres alg ON g.id = alg.genre_id
                    LEFT JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
                    WHERE gta.alias_slug IS NULL
                      AND NOT EXISTS (
                          SELECT 1
                          FROM genre_taxonomy_aliases gta_name
                          WHERE LOWER(TRIM(gta_name.alias_name)) = LOWER(TRIM(g.name))
                      )
                      AND g.slug = :focus_slug
                    GROUP BY g.id, g.entity_uid, g.name, g.slug
                    """
                ),
                {"focus_slug": focus_slug},
            ).mappings().first()
            if row:
                items.append(dict(row))

        remaining_limit = max(limit - len(items), 0)
        if remaining_limit > 0:
            rows = session.execute(
                text(
                    """
                    SELECT
                        g.id,
                        g.entity_uid::text AS entity_uid,
                        g.name,
                        g.slug,
                        COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
                        COUNT(DISTINCT alg.album_id)::INTEGER AS album_count
                    FROM genres g
                    LEFT JOIN artist_genres ag ON g.id = ag.genre_id
                    LEFT JOIN album_genres alg ON g.id = alg.genre_id
                    LEFT JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
                    WHERE gta.alias_slug IS NULL
                      AND NOT EXISTS (
                          SELECT 1
                          FROM genre_taxonomy_aliases gta_name
                          WHERE LOWER(TRIM(gta_name.alias_name)) = LOWER(TRIM(g.name))
                      )
                      AND (:focus_slug IS NULL OR g.slug <> :focus_slug)
                    GROUP BY g.id, g.entity_uid, g.name, g.slug
                    HAVING COUNT(DISTINCT ag.artist_name) > 0 OR COUNT(DISTINCT alg.album_id) > 0
                    ORDER BY COUNT(DISTINCT ag.artist_name) DESC, COUNT(DISTINCT alg.album_id) DESC, g.name ASC
                    LIMIT :remaining_limit
                    """
                ),
                {"focus_slug": focus_slug, "remaining_limit": remaining_limit},
            ).mappings().all()
            items.extend(dict(row) for row in rows)
    return items


def get_unmapped_genre_count() -> int:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT COUNT(*)::INTEGER AS cnt
                FROM genres g
                LEFT JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
                WHERE gta.alias_slug IS NULL
                  AND NOT EXISTS (
                      SELECT 1
                      FROM genre_taxonomy_aliases gta_name
                      WHERE LOWER(TRIM(gta_name.alias_name)) = LOWER(TRIM(g.name))
                  )
                """
            )
        ).mappings().first()
    return int(row["cnt"] or 0) if row else 0


__all__ = [
    "get_all_genres",
    "get_total_genre_count",
    "get_unmapped_genre_count",
    "get_unmapped_genres",
    "list_unmapped_genres_for_inference",
]
