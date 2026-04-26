from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_artists_count(joins: str, where_sql: str, params: dict) -> int:
    """Count distinct artists matching the filter."""
    with read_scope() as session:
        count_sql = f"SELECT COUNT(DISTINCT la.name) AS cnt FROM library_artists la {joins} WHERE {where_sql}"
        row = session.execute(text(count_sql), params).mappings().first()
        return row["cnt"]


def get_artists_page(
    select_cols: str,
    joins: str,
    where_sql: str,
    order_sql: str,
    params: dict,
    per_page: int,
    offset: int,
) -> list[dict]:
    """Return a paginated artist list."""
    all_params = {**params, "per_page": per_page, "offset": offset}
    with read_scope() as session:
        query_sql = (
            f"SELECT DISTINCT {select_cols} FROM library_artists la {joins} "
            f"WHERE {where_sql} ORDER BY {order_sql} LIMIT :per_page OFFSET :offset"
        )
        rows = session.execute(text(query_sql), all_params).mappings().all()
        return [dict(row) for row in rows]


__all__ = [
    "get_artists_count",
    "get_artists_page",
]
