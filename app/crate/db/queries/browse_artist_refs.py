from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_artist_refs_by_names_full(names: list[str]) -> dict[str, dict]:
    """Look up artist id/slug/name by lowercase name."""
    normalized_names = sorted({(name or "").strip() for name in names if (name or "").strip()})
    if not normalized_names:
        return {}

    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT id, slug, name
                FROM library_artists
                WHERE LOWER(name) = ANY(:names)
                """
            ),
            {"names": [name.lower() for name in normalized_names]},
        ).mappings().all()
        return {
            row["name"].lower(): {
                "id": row.get("id"),
                "slug": row.get("slug"),
                "name": row.get("name"),
            }
            for row in rows
        }


def get_similar_artist_refs(names: list[str]) -> dict[str, dict]:
    if not names:
        return {}

    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT id, slug, name
                FROM library_artists
                WHERE LOWER(name) = ANY(:names)
                """
            ),
            {"names": [name.lower() for name in names]},
        ).mappings().all()
        return {
            row["name"].lower(): {
                "id": row.get("id"),
                "slug": row.get("slug"),
            }
            for row in rows
        }


def check_artists_in_library(names: list[str]) -> set[str]:
    with read_scope() as session:
        rows = session.execute(
            text("SELECT name FROM library_artists WHERE LOWER(name) = ANY(:names)"),
            {"names": [n.lower() for n in names]},
        ).mappings().all()
        return {row["name"].lower() for row in rows}


__all__ = [
    "check_artists_in_library",
    "get_artist_refs_by_names_full",
    "get_similar_artist_refs",
]
