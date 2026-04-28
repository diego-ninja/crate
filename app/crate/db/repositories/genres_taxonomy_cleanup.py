from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.genres import list_invalid_genre_taxonomy_nodes
from crate.db.tx import transaction_scope
from crate.genre_taxonomy import invalidate_runtime_taxonomy_cache_after_commit


def cleanup_invalid_genre_taxonomy_nodes(*, dry_run: bool = True, session=None) -> dict:
    if session is None:
        with transaction_scope() as s:
            return cleanup_invalid_genre_taxonomy_nodes(dry_run=dry_run, session=s)

    invalid_items = list_invalid_genre_taxonomy_nodes(session=session)
    summary = {
        "dry_run": dry_run,
        "invalid_count": len(invalid_items),
        "deleted_count": 0,
        "alias_count": sum(int(item.get("alias_count") or 0) for item in invalid_items),
        "edge_count": sum(int(item.get("edge_count") or 0) for item in invalid_items),
        "items": invalid_items,
    }
    if dry_run or not invalid_items:
        return summary

    for item in invalid_items:
        session.execute(
            text("DELETE FROM genre_taxonomy_nodes WHERE id = :node_id"),
            {"node_id": item["id"]},
        )
    invalidate_runtime_taxonomy_cache_after_commit(session)
    summary["deleted_count"] = len(invalid_items)
    return summary


__all__ = ["cleanup_invalid_genre_taxonomy_nodes"]
