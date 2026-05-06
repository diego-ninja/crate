from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope

_MOOD_COLUMNS = {
    "acousticness",
    "bpm",
    "danceability",
    "energy",
    "instrumentalness",
    "valence",
}


def _convert_mood_params(conditions: list[str], params: list) -> tuple[list[str], dict]:
    named_conditions = []
    named_params = {}
    param_idx = 0
    for cond in conditions:
        if "%s" in cond:
            param_name = f"p{param_idx}"
            named_conditions.append(cond.replace("%s", f":{param_name}", 1))
            named_params[param_name] = params[param_idx]
            param_idx += 1
        else:
            named_conditions.append(cond)
    return named_conditions, named_params


def _mood_filter_expression(filters: Mapping[str, Any], prefix: str) -> tuple[str, dict[str, Any]]:
    clauses = ["bpm IS NOT NULL"]
    params: dict[str, Any] = {}
    for index, (key, value) in enumerate(filters.items()):
        try:
            column, suffix = key.rsplit("_", 1)
        except ValueError as exc:
            raise ValueError(f"Invalid mood filter: {key}") from exc
        if column not in _MOOD_COLUMNS or suffix not in {"min", "max"}:
            raise ValueError(f"Invalid mood filter: {key}")
        param_name = f"{prefix}_{index}"
        operator = ">=" if suffix == "min" else "<="
        clauses.append(f"{column} {operator} :{param_name}")
        params[param_name] = value
    return " AND ".join(clauses), params


def count_mood_tracks(conditions: list[str], params: list) -> int:
    named_conditions, named_params = _convert_mood_params(conditions, params)
    with read_scope() as session:
        row = session.execute(
            text(f"SELECT COUNT(*) AS cnt FROM library_tracks WHERE {' AND '.join(named_conditions)}"),
            named_params,
        ).mappings().first()
        return row["cnt"]


def count_mood_presets(presets: Mapping[str, Mapping[str, Any]]) -> dict[str, int]:
    if not presets:
        return {}

    select_parts: list[str] = []
    params: dict[str, Any] = {}
    aliases: dict[str, str] = {}
    for index, (name, filters) in enumerate(presets.items()):
        alias = f"mood_{index}"
        expression, expression_params = _mood_filter_expression(filters, alias)
        select_parts.append(f"COUNT(*) FILTER (WHERE {expression}) AS {alias}")
        params.update(expression_params)
        aliases[name] = alias

    with read_scope() as session:
        row = session.execute(
            text(f"SELECT {', '.join(select_parts)} FROM library_tracks WHERE bpm IS NOT NULL"),
            params,
        ).mappings().first()

    counts = dict(row or {})
    return {name: int(counts.get(alias) or 0) for name, alias in aliases.items()}


def get_mood_tracks(conditions: list[str], params: list, limit: int) -> list[dict]:
    named_conditions, named_params = _convert_mood_params(conditions, params)
    named_params["limit"] = limit
    with read_scope() as session:
        rows = session.execute(
            text(
                f"""SELECT t.id, t.title, t.artist, a.name AS album, t.path, t.duration,
                           t.entity_uid::text AS entity_uid,
                           ar.id AS artist_id, ar.entity_uid::text AS artist_entity_uid, ar.slug AS artist_slug,
                           a.id AS album_id, a.entity_uid::text AS album_entity_uid, a.slug AS album_slug,
                           t.bpm, t.energy, t.danceability, t.valence
                    FROM library_tracks t
                    JOIN library_albums a ON a.id = t.album_id
                    LEFT JOIN library_artists ar ON ar.name = t.artist
                    WHERE {' AND '.join(named_conditions)}
                    ORDER BY RANDOM() LIMIT :limit"""
            ),
            named_params,
        ).mappings().all()
        items: list[dict] = []
        for row in rows:
            item = dict(row)
            entity_uid = str(item["entity_uid"]) if item.get("entity_uid") is not None else None
            item["entity_uid"] = entity_uid
            item["artist_entity_uid"] = (
                str(item["artist_entity_uid"]) if item.get("artist_entity_uid") is not None else None
            )
            item["album_entity_uid"] = (
                str(item["album_entity_uid"]) if item.get("album_entity_uid") is not None else None
            )
            items.append(item)
        return items


__all__ = [
    "count_mood_presets",
    "count_mood_tracks",
    "get_mood_tracks",
]
