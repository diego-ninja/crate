from __future__ import annotations

from sqlalchemy import text

from crate.db.repositories.playlists_rule_engine_builder import build_rule_conditions
from crate.db.repositories.playlists_rule_engine_config import SORT_MAP
from crate.db.repositories.playlists_rule_engine_genre import combine_sql_extrema
from crate.db.tx import read_scope


def execute_smart_rules(rules: dict, *, count_only: bool = False) -> list[dict] | int:
    match_mode = rules.get("match", "all")
    rule_list = rules.get("rules", [])
    limit = rules.get("limit", 50)
    sort = rules.get("sort", "random")
    deduplicate_artist = rules.get("deduplicate_artist", False)
    max_per_artist = rules.get("max_per_artist", 3)

    where, params, genre_score_exprs = build_rule_conditions(rule_list, match_mode)

    with read_scope() as session:
        if count_only:
            row = session.execute(
                text(
                    f"""
                    SELECT COUNT(*) AS cnt
                    FROM library_tracks t
                    LEFT JOIN library_albums a ON t.album_id = a.id
                    LEFT JOIN library_artists a_artist ON t.artist = a_artist.name
                    WHERE ({where})
                      AND (t.entity_uid IS NOT NULL OR t.storage_id IS NOT NULL)
                    """
                ),
                params,
            ).mappings().first()
            return row["cnt"] if row else 0

        sort_clause = SORT_MAP.get(sort, "RANDOM()")
        if genre_score_exprs:
            genre_relevance = combine_sql_extrema(
                genre_score_exprs,
                mode="least" if match_mode == "all" else "greatest",
            )
            sort_clause = f"{genre_relevance} DESC, {sort_clause}"

        fetch_limit = limit * 3 if deduplicate_artist else limit
        query_params = {**params, "lim": fetch_limit}
        rows = session.execute(
            text(
                f"""
                SELECT t.id, t.entity_uid::text AS entity_uid, t.storage_id::text AS storage_id,
                       t.path, t.title, t.artist, a.name AS album,
                       t.duration, t.format, t.bpm, t.energy, t.genre, t.year,
                       a.id AS album_id, a.slug AS album_slug,
                       a_artist.id AS artist_id, a_artist.slug AS artist_slug
                FROM library_tracks t
                LEFT JOIN library_albums a ON t.album_id = a.id
                LEFT JOIN library_artists a_artist ON t.artist = a_artist.name
                WHERE ({where})
                  AND (t.entity_uid IS NOT NULL OR t.storage_id IS NOT NULL)
                ORDER BY {sort_clause}
                LIMIT :lim
                """
            ),
            query_params,
        ).mappings().all()

    results = [dict(row) for row in rows]
    if deduplicate_artist and max_per_artist > 0:
        artist_counts: dict[str, int] = {}
        deduped: list[dict] = []
        for track in results:
            artist = track.get("artist", "")
            count = artist_counts.get(artist, 0)
            if count < max_per_artist:
                deduped.append(track)
                artist_counts[artist] = count + 1
                if len(deduped) >= limit:
                    break
        return deduped
    return results[:limit]


__all__ = ["execute_smart_rules"]
