from __future__ import annotations


def combine_sql_extrema(expressions: list[str], mode: str = "greatest") -> str:
    if not expressions:
        return "0.0"
    if len(expressions) == 1:
        return expressions[0]
    fn = "LEAST" if mode == "least" else "GREATEST"
    return f"{fn}({', '.join(expressions)})"


def build_genre_relevance_expression(values: list[str], params: dict, next_param) -> str:
    per_value_scores: list[str] = []

    for raw_value in values:
        value = raw_value.strip()
        if not value:
            continue

        p_track = next_param("g")
        p_album = next_param("g")
        p_artist = next_param("g")
        pattern = f"%{value}%"
        params[p_track] = pattern
        params[p_album] = pattern
        params[p_artist] = pattern

        per_value_scores.append(
            f"""GREATEST(
                CASE WHEN t.genre ILIKE :{p_track} THEN 1.0 ELSE 0.0 END,
                COALESCE((
                    SELECT MAX(ag.weight)
                    FROM album_genres ag
                    JOIN genres g ON g.id = ag.genre_id
                    WHERE ag.album_id = a.id
                      AND (g.name ILIKE :{p_album} OR g.slug ILIKE :{p_album})
                ), 0.0),
                COALESCE((
                    SELECT MAX(arg.weight)
                    FROM artist_genres arg
                    JOIN genres g ON g.id = arg.genre_id
                    WHERE arg.artist_name = t.artist
                      AND (g.name ILIKE :{p_artist} OR g.slug ILIKE :{p_artist})
                ), 0.0)
            )"""
        )

    return combine_sql_extrema(per_value_scores, mode="greatest")


__all__ = [
    "build_genre_relevance_expression",
    "combine_sql_extrema",
]
