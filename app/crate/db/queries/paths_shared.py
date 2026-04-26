"""Shared helpers for path read queries."""

from __future__ import annotations


def array_distance_sql(vector_expr: str) -> str:
    return f"""
        SQRT(COALESCE((
            SELECT SUM(POWER(tv.val - pv.val, 2))
            FROM UNNEST({vector_expr}) WITH ORDINALITY AS tv(val, idx)
            JOIN UNNEST(CAST(:probe_array AS double precision[])) WITH ORDINALITY AS pv(val, idx)
              USING (idx)
        ), 0.0))
    """


__all__ = ["array_distance_sql"]
