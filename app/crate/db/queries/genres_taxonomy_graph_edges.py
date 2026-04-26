from __future__ import annotations

from sqlalchemy import text


def load_genre_graph_edge_rows(session, canonical_slug: str) -> list[dict]:
    return [
        dict(row)
        for row in session.execute(
            text(
                """
                WITH RECURSIVE reachable(slug, depth) AS (
                    SELECT CAST(:canonical_slug AS TEXT), 0
                    UNION
                    SELECT
                        CASE WHEN r.slug = source.slug THEN target.slug ELSE source.slug END,
                        r.depth + 1
                    FROM reachable r
                    JOIN genre_taxonomy_nodes n ON n.slug = r.slug
                    JOIN genre_taxonomy_edges edge
                      ON edge.source_genre_id = n.id OR edge.target_genre_id = n.id
                    JOIN genre_taxonomy_nodes source ON source.id = edge.source_genre_id
                    JOIN genre_taxonomy_nodes target ON target.id = edge.target_genre_id
                    WHERE r.depth < 2
                      AND edge.relation_type IN ('parent', 'related', 'influenced_by', 'fusion_of')
                )
                SELECT DISTINCT
                    source.slug AS source_slug,
                    source.name AS source_name,
                    source.is_top_level AS source_is_top_level,
                    target.slug AS target_slug,
                    target.name AS target_name,
                    target.is_top_level AS target_is_top_level,
                    edge.relation_type
                FROM genre_taxonomy_edges edge
                JOIN genre_taxonomy_nodes source ON source.id = edge.source_genre_id
                JOIN genre_taxonomy_nodes target ON target.id = edge.target_genre_id
                WHERE edge.relation_type IN ('parent', 'related', 'influenced_by', 'fusion_of')
                  AND (source.slug IN (SELECT slug FROM reachable)
                    OR target.slug IN (SELECT slug FROM reachable))
                """
            ),
            {"canonical_slug": canonical_slug},
        ).mappings().all()
    ]


__all__ = ["load_genre_graph_edge_rows"]
