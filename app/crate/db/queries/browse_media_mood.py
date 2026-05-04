from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import transaction_scope


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


def count_mood_tracks(conditions: list[str], params: list) -> int:
    named_conditions, named_params = _convert_mood_params(conditions, params)
    with transaction_scope() as session:
        row = session.execute(
            text(f"SELECT COUNT(*) AS cnt FROM library_tracks WHERE {' AND '.join(named_conditions)}"),
            named_params,
        ).mappings().first()
        return row["cnt"]


def get_mood_tracks(conditions: list[str], params: list, limit: int) -> list[dict]:
    named_conditions, named_params = _convert_mood_params(conditions, params)
    named_params["limit"] = limit
    with transaction_scope() as session:
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
    "count_mood_tracks",
    "get_mood_tracks",
]
