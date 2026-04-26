from __future__ import annotations

from crate.db.repositories.playlists_rule_engine_config import FIELD_COLUMNS, TEXT_FIELDS
from crate.db.repositories.playlists_rule_engine_genre import build_genre_relevance_expression


def split_pipe_values(value: str) -> list[str]:
    return [item.strip() for item in value.split("|") if item.strip()]


def build_rule_conditions(rule_list: list[dict], match_mode: str) -> tuple[str, dict, list[str]]:
    conditions: list[str] = []
    genre_score_exprs: list[str] = []
    params: dict = {}
    param_idx = 0

    def next_param(prefix: str = "p") -> str:
        nonlocal param_idx
        param_idx += 1
        return f"{prefix}_{param_idx}"

    for rule in rule_list:
        field = rule.get("field", "")
        op = rule.get("op", "")
        value = rule.get("value")
        col = FIELD_COLUMNS.get(field)
        if not col:
            continue

        if field == "genre" and op == "contains":
            values = split_pipe_values(value) if isinstance(value, str) and "|" in value else [str(value)]
            score_expr = build_genre_relevance_expression(values, params, next_param)
            conditions.append(f"({score_expr}) > 0")
            genre_score_exprs.append(score_expr)
            continue

        if isinstance(value, str) and "|" in value and op in {"eq", "contains"}:
            values = split_pipe_values(value)
            placeholders: list[str] = []
            for item in values:
                param = next_param("v")
                params[param] = item
                placeholders.append(f":{param}")
            conditions.append(f"{col} IN ({','.join(placeholders)})")
            continue

        if op == "eq":
            param = next_param("v")
            if field in TEXT_FIELDS:
                conditions.append(f"{col} ILIKE :{param}")
                params[param] = str(value)
            else:
                conditions.append(f"{col} = :{param}")
                params[param] = value
        elif op == "neq":
            param = next_param("v")
            conditions.append(f"{col} != :{param}")
            params[param] = value
        elif op == "contains":
            param = next_param("v")
            conditions.append(f"{col} ILIKE :{param}")
            params[param] = f"%{value}%"
        elif op == "not_contains":
            param = next_param("v")
            conditions.append(f"{col} NOT ILIKE :{param}")
            params[param] = f"%{value}%"
        elif op == "gte":
            param = next_param("v")
            conditions.append(f"{col} >= :{param}")
            params[param] = value
        elif op == "lte":
            param = next_param("v")
            conditions.append(f"{col} <= :{param}")
            params[param] = value
        elif op == "between" and isinstance(value, list) and len(value) >= 2:
            p_lo, p_hi = next_param("lo"), next_param("hi")
            conditions.append(f"{col} BETWEEN :{p_lo} AND :{p_hi}")
            params[p_lo] = value[0]
            params[p_hi] = value[1]
        elif op == "in" and isinstance(value, list):
            placeholders: list[str] = []
            for item in value:
                param = next_param("v")
                params[param] = item
                placeholders.append(f":{param}")
            if placeholders:
                conditions.append(f"{col} IN ({','.join(placeholders)})")

    joiner = " AND " if match_mode == "all" else " OR "
    where = joiner.join(conditions) if conditions else "1=1"
    return where, params, genre_score_exprs


__all__ = [
    "build_rule_conditions",
    "split_pipe_values",
]
