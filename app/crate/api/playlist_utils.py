from crate.db import get_db_ctx
from crate.playlist_covers import delete_playlist_cover, persist_playlist_cover_data


def apply_playlist_cover_payload(
    playlist_id: int,
    cover_data_url: str | None,
    existing_cover_path: str | None = None,
) -> dict | None:
    if cover_data_url is None:
        return None
    if cover_data_url == "":
        delete_playlist_cover(existing_cover_path)
        return {"cover_data_url": None, "cover_path": None}
    if cover_data_url.startswith("data:image/"):
        new_cover_path = persist_playlist_cover_data(playlist_id, cover_data_url)
        if existing_cover_path and existing_cover_path != new_cover_path:
            delete_playlist_cover(existing_cover_path)
        return {"cover_data_url": None, "cover_path": new_cover_path}
    return {"cover_data_url": cover_data_url}


def execute_smart_rules(rules: dict) -> list[dict]:
    """Execute smart playlist rules against the library DB."""
    match_mode = rules.get("match", "all")  # "all" or "any"
    rule_list = rules.get("rules", [])
    limit = rules.get("limit", 50)
    sort = rules.get("sort", "random")

    conditions = []
    params: list = []

    for rule in rule_list:
        field = rule.get("field", "")
        op = rule.get("op", "")
        value = rule.get("value")

        if field == "genre" and op == "contains":
            if isinstance(value, str) and "|" in value:
                genre_vals = [v.strip() for v in value.split("|") if v.strip()]
                or_parts = []
                for gv in genre_vals:
                    or_parts.append("(t.genre ILIKE %s OR a_artist.tags_json::text ILIKE %s)")
                    params.extend([f"%{gv}%", f"%{gv}%"])
                conditions.append(f"({' OR '.join(or_parts)})")
            else:
                conditions.append("(t.genre ILIKE %s OR a_artist.tags_json::text ILIKE %s)")
                params.extend([f"%{value}%", f"%{value}%"])
        elif field == "bpm" and op == "between" and isinstance(value, list):
            conditions.append("t.bpm BETWEEN %s AND %s")
            params.extend(value[:2])
        elif field == "energy" and op == "gte":
            conditions.append("t.energy >= %s")
            params.append(value)
        elif field == "energy" and op == "lte":
            conditions.append("t.energy <= %s")
            params.append(value)
        elif field == "year" and op == "between" and isinstance(value, list):
            conditions.append("t.year BETWEEN %s AND %s")
            params.extend([str(v) for v in value[:2]])
        elif field == "audio_key" and op == "eq":
            conditions.append("t.audio_key = %s")
            params.append(value)
        elif field == "danceability" and op == "gte":
            conditions.append("t.danceability >= %s")
            params.append(value)
        elif field == "valence" and op == "gte":
            conditions.append("t.valence >= %s")
            params.append(value)
        elif field == "artist" and op == "eq":
            if isinstance(value, str) and "|" in value:
                vals = [v.strip() for v in value.split("|") if v.strip()]
                conditions.append(f"t.artist IN ({','.join(['%s']*len(vals))})")
                params.extend(vals)
            else:
                conditions.append("t.artist = %s")
                params.append(value)
        elif field == "popularity" and op == "gte":
            conditions.append("t.popularity >= %s")
            params.append(int(value))
        elif field == "popularity" and op == "lte":
            conditions.append("t.popularity <= %s")
            params.append(int(value))
        elif field == "popularity" and op == "between" and isinstance(value, list):
            conditions.append("t.popularity BETWEEN %s AND %s")
            params.extend([int(v) for v in value[:2]])
        elif field == "format" and op == "eq":
            if isinstance(value, str) and "|" in value:
                vals = [v.strip() for v in value.split("|") if v.strip()]
                conditions.append(f"t.format IN ({','.join(['%s']*len(vals))})")
                params.extend(vals)
            else:
                conditions.append("t.format = %s")
                params.append(value)

    joiner = " AND " if match_mode == "all" else " OR "
    where = joiner.join(conditions) if conditions else "1=1"

    sort_map = {
        "random": "RANDOM()",
        "popularity": "t.popularity DESC NULLS LAST",
        "bpm": "t.bpm ASC NULLS LAST",
        "energy": "t.energy DESC NULLS LAST",
        "title": "t.title ASC",
    }
    sort_clause = sort_map.get(sort, "RANDOM()")

    query = f"""
        SELECT t.path, t.title, t.artist, t.album, t.duration
        FROM library_tracks t
        LEFT JOIN library_artists a_artist ON t.artist = a_artist.name
        WHERE {where}
        ORDER BY {sort_clause}
        LIMIT %s
    """
    params.append(limit)

    with get_db_ctx() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()

    return [dict(r) for r in rows]
