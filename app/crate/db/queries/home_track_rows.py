from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def _fetch_rows(sql: str, params: dict) -> list[dict]:
    with read_scope() as session:
        session.execute(text("SET LOCAL statement_timeout = '5s'"))
        rows = session.execute(text(sql), params).mappings().all()
    return [dict(row) for row in rows]


__all__ = ["_fetch_rows"]
