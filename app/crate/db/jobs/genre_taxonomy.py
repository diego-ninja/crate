import re
import unicodedata

from crate.db.tx import transaction_scope
from sqlalchemy import text


def _slugify_genre(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", (value or "").strip().lower())
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_value).strip("-")


def assign_genre_alias_in_session(session, alias_value: str, canonical_slug: str) -> bool:
    alias_name = (alias_value or "").strip().lower()
    alias_slug = _slugify_genre(alias_name)
    canonical_slug = (canonical_slug or "").strip().lower()
    if not alias_name or not alias_slug or not canonical_slug:
        return False

    node_row = session.execute(
        text("SELECT id FROM genre_taxonomy_nodes WHERE slug = :slug"),
        {"slug": canonical_slug},
    ).mappings().first()
    if not node_row:
        return False

    session.execute(
        text("DELETE FROM genre_taxonomy_aliases WHERE alias_name = :alias_name AND alias_slug != :alias_slug"),
        {"alias_name": alias_name, "alias_slug": alias_slug},
    )
    session.execute(
        text(
            """
            INSERT INTO genre_taxonomy_aliases (alias_slug, alias_name, genre_id)
            VALUES (:alias_slug, :alias_name, :genre_id)
            ON CONFLICT (alias_slug) DO UPDATE
            SET alias_name = EXCLUDED.alias_name,
                genre_id = EXCLUDED.genre_id
            """
        ),
        {"alias_slug": alias_slug, "alias_name": alias_name, "genre_id": node_row["id"]},
    )
    return True


def assign_genre_alias_value(alias_value: str, canonical_slug: str) -> bool:
    with transaction_scope() as session:
        return assign_genre_alias_in_session(session, alias_value, canonical_slug)


def seed_genre_taxonomy_definitions(session, definitions) -> None:
    slugs_with_gains = [definition.slug for definition in definitions if definition.eq_gains is not None]
    existing_count = session.execute(
        text("SELECT COUNT(*)::INTEGER AS cnt FROM genre_taxonomy_nodes WHERE slug = ANY(:slugs)"),
        {"slugs": [definition.slug for definition in definitions]},
    ).mappings().first()["cnt"]
    existing_gains_count = session.execute(
        text(
            "SELECT COUNT(*)::INTEGER AS cnt FROM genre_taxonomy_nodes "
            "WHERE slug = ANY(:slugs) AND eq_gains IS NOT NULL"
        ),
        {"slugs": slugs_with_gains},
    ).mappings().first()["cnt"]
    if existing_count == len(definitions) and existing_gains_count == len(slugs_with_gains):
        return

    for definition in definitions:
        session.execute(
            text(
                """
                INSERT INTO genre_taxonomy_nodes (slug, name, description, is_top_level, eq_gains)
                VALUES (:slug, :name, :description, :is_top_level, :eq_gains)
                ON CONFLICT (slug) DO UPDATE
                SET name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    is_top_level = EXCLUDED.is_top_level,
                    eq_gains = EXCLUDED.eq_gains
                """
            ),
            {
                "slug": definition.slug,
                "name": definition.name,
                "description": definition.description,
                "is_top_level": definition.top_level,
                "eq_gains": list(definition.eq_gains) if definition.eq_gains is not None else None,
            },
        )

    node_ids = {
        row["slug"]: row["id"]
        for row in session.execute(text("SELECT id, slug FROM genre_taxonomy_nodes")).mappings().all()
    }

    for definition in definitions:
        genre_id = node_ids.get(definition.slug)
        if genre_id is None:
            continue
        alias_entries: list[tuple[str, str]] = []
        seen_alias_slugs: set[str] = set()
        for candidate_name in (definition.slug.replace("-", " "), definition.name, *definition.aliases):
            normalized_alias = (candidate_name or "").strip().lower()
            alias_slug = _slugify_genre(normalized_alias)
            if not normalized_alias or not alias_slug or alias_slug in seen_alias_slugs:
                continue
            seen_alias_slugs.add(alias_slug)
            alias_entries.append((alias_slug, normalized_alias))

        for alias_slug, alias_name in alias_entries:
            session.execute(
                text("DELETE FROM genre_taxonomy_aliases WHERE alias_name = :alias_name AND alias_slug != :alias_slug"),
                {"alias_name": alias_name, "alias_slug": alias_slug},
            )
            session.execute(
                text(
                    """
                    INSERT INTO genre_taxonomy_aliases (alias_slug, alias_name, genre_id)
                    VALUES (:alias_slug, :alias_name, :genre_id)
                    ON CONFLICT (alias_slug) DO UPDATE
                    SET alias_name = EXCLUDED.alias_name,
                        genre_id = EXCLUDED.genre_id
                    """
                ),
                {"alias_slug": alias_slug, "alias_name": alias_name, "genre_id": genre_id},
            )

    for definition in definitions:
        source_id = node_ids.get(definition.slug)
        if source_id is None:
            continue
        for parent_slug in definition.parents:
            target_id = node_ids.get(parent_slug)
            if target_id is None:
                continue
            session.execute(
                text(
                    """
                    INSERT INTO genre_taxonomy_edges (source_genre_id, target_genre_id, relation_type, weight)
                    VALUES (:source_id, :target_id, 'parent', 1.0)
                    ON CONFLICT (source_genre_id, target_genre_id, relation_type) DO UPDATE
                    SET weight = EXCLUDED.weight
                    """
                ),
                {"source_id": source_id, "target_id": target_id},
            )
        for related_slug in definition.related:
            target_id = node_ids.get(related_slug)
            if target_id is None:
                continue
            session.execute(
                text(
                    """
                    INSERT INTO genre_taxonomy_edges (source_genre_id, target_genre_id, relation_type, weight)
                    VALUES (:source_id, :target_id, 'related', 0.7)
                    ON CONFLICT (source_genre_id, target_genre_id, relation_type) DO UPDATE
                    SET weight = EXCLUDED.weight
                    """
                ),
                {"source_id": source_id, "target_id": target_id},
            )
