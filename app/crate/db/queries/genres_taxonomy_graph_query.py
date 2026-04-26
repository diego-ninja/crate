from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.genres_shared import get_genre_summary_by_slug, get_taxonomy_node_stats
from crate.db.queries.genres_taxonomy_graph_edges import load_genre_graph_edge_rows
from crate.db.queries.genres_taxonomy_graph_hierarchy import build_genre_graph_relationships
from crate.db.queries.genres_taxonomy_graph_nodes import build_genre_graph_payload
from crate.db.tx import read_scope
from crate.genre_taxonomy import resolve_genre_slug


def get_genre_graph(slug: str) -> dict | None:
    with read_scope() as session:
        genre = get_genre_summary_by_slug(session, slug)
        canonical_slug = genre.get("canonical_slug") if genre else None
        if canonical_slug is None:
            resolved = resolve_genre_slug(slug)
            taxonomy_row = session.execute(
                text("SELECT slug, name, is_top_level FROM genre_taxonomy_nodes WHERE slug = :slug"),
                {"slug": resolved},
            ).mappings().first()
            canonical_slug = taxonomy_row["slug"] if taxonomy_row else None

        if not canonical_slug:
            if not genre:
                return None
            return {
                "nodes": [
                    {
                        "id": f"library:{genre['slug']}",
                        "slug": genre["slug"],
                        "label": genre["name"],
                        "kind": "unmapped",
                        "mapped": False,
                        "artist_count": genre["artist_count"],
                        "album_count": genre["album_count"],
                        "description": genre.get("description")
                        or "raw library tag detected in your collection but not yet linked into the curated taxonomy.",
                        "page_slug": genre["slug"],
                        "is_center": True,
                        "is_top_level": False,
                    }
                ],
                "links": [],
                "mapping": genre,
            }

        edge_rows = load_genre_graph_edge_rows(session, canonical_slug)
        relationships = build_genre_graph_relationships(edge_rows, canonical_slug)
        taxonomy_stats = get_taxonomy_node_stats(session, list(dict.fromkeys(relationships["taxonomy_slugs"])))
        return build_genre_graph_payload(
            genre=genre,
            canonical_slug=canonical_slug,
            taxonomy_slugs=relationships["taxonomy_slugs"],
            taxonomy_stats=taxonomy_stats,
            hierarchy_links=relationships["hierarchy_links"],
            direct_relation_links=relationships["direct_relation_links"],
        )


__all__ = ["get_genre_graph"]
