from __future__ import annotations

from sqlalchemy import text

from crate.genre_taxonomy import (
    get_genre_description,
    get_genre_display_name,
    get_top_level_slug,
    resolve_genre_eq_preset,
)


def invalid_genre_taxonomy_reason(slug: str) -> str | None:
    normalized = (slug or "").strip().lower()
    if not normalized:
        return None
    if normalized in {"wikidata", "other-databases"}:
        return "external-section-marker"
    if normalized.startswith(("http-", "https-")):
        return "external-url"
    if normalized.startswith("q") and normalized[1:].isdigit():
        return "wikidata-entity-id"
    return None


def annotate_genre_mapping(items: list[dict]) -> list[dict]:
    for item in items:
        canonical_slug = item.get("canonical_slug")
        item["mapped"] = canonical_slug is not None
        if canonical_slug:
            top_level_slug = get_top_level_slug(canonical_slug) or canonical_slug
            item["top_level_slug"] = top_level_slug
            item["top_level_name"] = get_genre_display_name(top_level_slug)
            item["top_level_description"] = get_genre_description(top_level_slug)
            item["description"] = item.get("canonical_description") or get_genre_description(canonical_slug)
        else:
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


def annotate_eq_preset(item: dict) -> None:
    canonical_gains = item.pop("canonical_eq_gains", None)
    canonical_slug = item.get("canonical_slug")

    item["eq_gains"] = [float(v) for v in canonical_gains] if canonical_gains is not None else None
    item["eq_preset_resolved"] = resolve_genre_eq_preset(canonical_slug) if canonical_slug else None


def get_genre_summary_by_slug(session, slug: str) -> dict | None:
    row = session.execute(
        text(
            """
            SELECT
                g.id,
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
                tn.wikidata_url,
                tn.eq_gains AS canonical_eq_gains,
                tn.eq_reasoning
            FROM genres g
            LEFT JOIN artist_genres ag ON g.id = ag.genre_id
            LEFT JOIN album_genres alg ON g.id = alg.genre_id
            LEFT JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
            LEFT JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
            WHERE g.slug = :slug
            GROUP BY
                g.id,
                g.name,
                g.slug,
                tn.slug,
                tn.name,
                tn.description,
                tn.external_description,
                tn.external_description_source,
                tn.musicbrainz_mbid,
                tn.wikidata_entity_id,
                tn.wikidata_url,
                tn.eq_gains,
                tn.eq_reasoning
            """
        ),
        {"slug": slug},
    ).mappings().first()
    if not row:
        return None
    annotated = annotate_genre_mapping([dict(row)])[0]
    annotate_eq_preset(annotated)
    return annotated


def get_taxonomy_node_stats(session, slugs: list[str]) -> dict[str, dict]:
    if not slugs:
        return {}
    rows = session.execute(
        text(
            """
            SELECT
                n.slug,
                n.name,
                n.description,
                n.external_description,
                n.is_top_level,
                COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
                COUNT(DISTINCT alg.album_id)::INTEGER AS album_count
            FROM genre_taxonomy_nodes n
            LEFT JOIN genre_taxonomy_aliases gta ON gta.genre_id = n.id
            LEFT JOIN genres g ON g.slug = gta.alias_slug
            LEFT JOIN artist_genres ag ON ag.genre_id = g.id
            LEFT JOIN album_genres alg ON alg.genre_id = g.id
            WHERE n.slug = ANY(:slugs)
            GROUP BY n.id, n.slug, n.name, n.description, n.external_description, n.is_top_level
            """
        ),
        {"slugs": slugs},
    ).mappings().all()
    stats = {row["slug"]: dict(row) for row in rows}

    rows = session.execute(
        text(
            """
            WITH alias_counts AS (
                SELECT
                    n.slug AS taxonomy_slug,
                    g.slug AS genre_slug,
                    g.name AS genre_name,
                    COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
                    COUNT(DISTINCT alg.album_id)::INTEGER AS album_count
                FROM genre_taxonomy_nodes n
                LEFT JOIN genre_taxonomy_aliases gta ON gta.genre_id = n.id
                LEFT JOIN genres g ON g.slug = gta.alias_slug
                LEFT JOIN artist_genres ag ON ag.genre_id = g.id
                LEFT JOIN album_genres alg ON alg.genre_id = g.id
                WHERE n.slug = ANY(:slugs)
                GROUP BY n.id, n.slug, g.id, g.slug, g.name
            )
            SELECT DISTINCT ON (taxonomy_slug)
                taxonomy_slug,
                genre_slug,
                genre_name
            FROM alias_counts
            WHERE genre_slug IS NOT NULL
            ORDER BY taxonomy_slug, artist_count DESC, album_count DESC, genre_slug ASC
            """
        ),
        {"slugs": slugs},
    ).mappings().all()
    for row in rows:
        bucket = stats.get(row["taxonomy_slug"])
        if not bucket:
            continue
        bucket["page_slug"] = row["genre_slug"]
        bucket["page_name"] = row["genre_name"]

    for slug in slugs:
        bucket = stats.setdefault(
            slug,
            {
                "slug": slug,
                "name": get_genre_display_name(slug),
                "description": get_genre_description(slug),
                "external_description": "",
                "is_top_level": False,
                "artist_count": 0,
                "album_count": 0,
            },
        )
        bucket.setdefault("page_slug", None)
        bucket.setdefault("page_name", None)
    return stats


__all__ = [
    "annotate_eq_preset",
    "annotate_genre_mapping",
    "get_genre_summary_by_slug",
    "get_taxonomy_node_stats",
    "invalid_genre_taxonomy_reason",
]
