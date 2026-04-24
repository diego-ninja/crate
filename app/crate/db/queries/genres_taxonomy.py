from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.genres_shared import invalid_genre_taxonomy_reason
from crate.db.tx import read_scope
from crate.genre_taxonomy import resolve_genre_slug


def list_invalid_genre_taxonomy_nodes(*, session=None) -> list[dict]:
    if session is None:
        with read_scope() as s:
            return list_invalid_genre_taxonomy_nodes(session=s)

    rows = session.execute(
        text(
            """
            SELECT
                n.id,
                n.slug,
                n.name,
                COUNT(DISTINCT a.alias_slug)::INTEGER AS alias_count,
                COUNT(DISTINCT (e.source_genre_id, e.target_genre_id, e.relation_type))::INTEGER AS edge_count
            FROM genre_taxonomy_nodes n
            LEFT JOIN genre_taxonomy_aliases a ON a.genre_id = n.id
            LEFT JOIN genre_taxonomy_edges e
              ON e.source_genre_id = n.id
              OR e.target_genre_id = n.id
            GROUP BY n.id, n.slug, n.name
            ORDER BY n.slug ASC
            """
        )
    ).mappings().all()

    invalid_items: list[dict] = []
    for row in rows:
        item = dict(row)
        reason = invalid_genre_taxonomy_reason(item["slug"])
        if not reason:
            continue
        item["reason"] = reason
        invalid_items.append(item)
    return invalid_items


def list_genre_taxonomy_nodes_for_external_enrichment(
    *,
    limit: int = 100,
    focus_slug: str | None = None,
    only_missing_external: bool = True,
) -> list[dict]:
    with read_scope() as session:
        query = """
            SELECT
                slug,
                name,
                description,
                external_description,
                external_description_source,
                musicbrainz_mbid,
                wikidata_entity_id,
                wikidata_url,
                is_top_level
            FROM genre_taxonomy_nodes
            WHERE 1=1
        """
        params: dict = {}
        if focus_slug:
            query += " AND slug = :focus_slug"
            params["focus_slug"] = (focus_slug or "").strip().lower()
        if only_missing_external:
            query += " AND (external_description IS NULL OR external_description = '')"
        query += " ORDER BY is_top_level DESC, slug ASC LIMIT :lim"
        params["lim"] = max(1, min(int(limit or 100), 500))
        rows = session.execute(text(query), params).mappings().all()
        return [dict(row) for row in rows]


def list_genre_taxonomy_nodes_for_musicbrainz_sync(
    *,
    limit: int = 100,
    focus_slug: str | None = None,
) -> list[dict]:
    resolved_focus = resolve_genre_slug(focus_slug or "") if focus_slug else None
    with read_scope() as session:
        query = """
            SELECT
                n.slug,
                n.name,
                n.description,
                n.external_description,
                n.external_description_source,
                n.musicbrainz_mbid,
                n.wikidata_entity_id,
                n.wikidata_url,
                n.is_top_level,
                COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
                COUNT(DISTINCT alg.album_id)::INTEGER AS album_count
            FROM genre_taxonomy_nodes n
            LEFT JOIN genre_taxonomy_aliases gta ON gta.genre_id = n.id
            LEFT JOIN genres g ON g.slug = gta.alias_slug
            LEFT JOIN artist_genres ag ON ag.genre_id = g.id
            LEFT JOIN album_genres alg ON alg.genre_id = g.id
            WHERE 1=1
        """
        params: dict = {}
        if resolved_focus:
            query += " AND n.slug = :focus_slug"
            params["focus_slug"] = resolved_focus
        query += """
            GROUP BY
                n.id,
                n.slug,
                n.name,
                n.description,
                n.external_description,
                n.external_description_source,
                n.musicbrainz_mbid,
                n.wikidata_entity_id,
                n.wikidata_url,
                n.is_top_level
            ORDER BY
                CASE WHEN n.musicbrainz_mbid IS NULL OR n.musicbrainz_mbid = '' THEN 0 ELSE 1 END,
                COUNT(DISTINCT ag.artist_name) DESC,
                COUNT(DISTINCT alg.album_id) DESC,
                n.is_top_level DESC,
                n.name ASC
            LIMIT :lim
        """
        params["lim"] = max(1, min(int(limit or 100), 500))
        rows = session.execute(text(query), params).mappings().all()
        return [dict(row) for row in rows]


def get_genre_taxonomy_node_id(slug: str) -> int | None:
    with read_scope() as session:
        row = session.execute(
            text("SELECT id FROM genre_taxonomy_nodes WHERE slug = :slug"),
            {"slug": slug},
        ).mappings().first()
    return row["id"] if row else None


def get_remaining_without_external_description() -> int:
    with read_scope() as session:
        row = session.execute(
            text("SELECT COUNT(*)::INTEGER AS cnt FROM genre_taxonomy_nodes WHERE external_description IS NULL OR external_description = ''")
        ).mappings().first()
    return int(row["cnt"] or 0) if row else 0


__all__ = [
    "get_genre_taxonomy_node_id",
    "get_remaining_without_external_description",
    "list_genre_taxonomy_nodes_for_external_enrichment",
    "list_genre_taxonomy_nodes_for_musicbrainz_sync",
    "list_invalid_genre_taxonomy_nodes",
]
