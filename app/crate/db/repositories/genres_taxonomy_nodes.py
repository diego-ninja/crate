from __future__ import annotations

from sqlalchemy import text

from crate.db.repositories.genres_taxonomy_shared import (
    normalize_taxonomy_text,
    slugify_taxonomy_value,
)
from crate.db.tx import transaction_scope
from crate.genre_taxonomy import invalidate_runtime_taxonomy_cache_after_commit


def upsert_genre_taxonomy_node(
    slug: str,
    *,
    name: str | None = None,
    description: str | None = None,
    is_top_level: bool = False,
    musicbrainz_mbid: str | None = None,
    session=None,
) -> dict | None:
    candidate_slug = slugify_taxonomy_value(slug or name or "")
    candidate_name = normalize_taxonomy_text(name or slug or "")
    candidate_description = normalize_taxonomy_text(description or "")
    mbid = (musicbrainz_mbid or "").strip() or None
    if not candidate_slug:
        return None
    if not candidate_name:
        candidate_name = candidate_slug.replace("-", " ")

    if session is None:
        with transaction_scope() as s:
            return upsert_genre_taxonomy_node(
                slug,
                name=name,
                description=description,
                is_top_level=is_top_level,
                musicbrainz_mbid=musicbrainz_mbid,
                session=s,
            )

    row = None
    if mbid:
        row = session.execute(
            text(
                "SELECT id, slug, name, description, is_top_level, musicbrainz_mbid "
                "FROM genre_taxonomy_nodes WHERE musicbrainz_mbid = :mbid"
            ),
            {"mbid": mbid},
        ).mappings().first()
    if not row:
        row = session.execute(
            text(
                "SELECT id, slug, name, description, is_top_level, musicbrainz_mbid "
                "FROM genre_taxonomy_nodes WHERE slug = :slug"
            ),
            {"slug": candidate_slug},
        ).mappings().first()

    if row:
        row = dict(row)
        update_fields: list[str] = []
        values: dict = {"node_id": row["id"]}
        idx = 0
        current_name = normalize_taxonomy_text(row.get("name"))
        generic_name = row["slug"].replace("-", " ")
        if candidate_name and (not current_name or current_name == generic_name):
            update_fields.append(f"name = :u{idx}")
            values[f"u{idx}"] = candidate_name
            idx += 1
        if candidate_description and not normalize_taxonomy_text(row.get("description")):
            update_fields.append(f"description = :u{idx}")
            values[f"u{idx}"] = candidate_description
            idx += 1
        if is_top_level and not row.get("is_top_level"):
            update_fields.append("is_top_level = TRUE")
        if mbid and not (row.get("musicbrainz_mbid") or "").strip():
            update_fields.append(f"musicbrainz_mbid = :u{idx}")
            values[f"u{idx}"] = mbid
            idx += 1
        if update_fields:
            row = dict(
                session.execute(
                    text(
                        f"""
                        UPDATE genre_taxonomy_nodes
                        SET {', '.join(update_fields)}
                        WHERE id = :node_id
                        RETURNING id, slug, name, description, is_top_level, musicbrainz_mbid
                        """
                    ),
                    values,
                ).mappings().first()
            )
    else:
        row = dict(
            session.execute(
                text(
                    """
                    INSERT INTO genre_taxonomy_nodes (slug, name, description, is_top_level, musicbrainz_mbid)
                    VALUES (:slug, :name, :description, :is_top_level, :mbid)
                    RETURNING id, slug, name, description, is_top_level, musicbrainz_mbid
                    """
                ),
                {
                    "slug": candidate_slug,
                    "name": candidate_name,
                    "description": candidate_description,
                    "is_top_level": bool(is_top_level),
                    "mbid": mbid,
                },
            ).mappings().first()
        )

    alias_entries: list[tuple[str, str]] = []
    seen_alias_slugs: set[str] = set()
    for candidate_alias in (row["slug"].replace("-", " "), row["name"], candidate_name):
        alias_name = normalize_taxonomy_text(candidate_alias)
        alias_slug = slugify_taxonomy_value(alias_name)
        if not alias_name or not alias_slug or alias_slug in seen_alias_slugs:
            continue
        seen_alias_slugs.add(alias_slug)
        alias_entries.append((alias_slug, alias_name))

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
            {"alias_slug": alias_slug, "alias_name": alias_name, "genre_id": row["id"]},
        )

    invalidate_runtime_taxonomy_cache_after_commit(session)
    return row


__all__ = ["upsert_genre_taxonomy_node"]
