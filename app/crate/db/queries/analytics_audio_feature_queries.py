from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_insights_feature_coverage() -> list[dict]:
    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN bpm IS NOT NULL THEN 1 ELSE 0 END) AS bpm,
                    SUM(CASE WHEN audio_key IS NOT NULL AND audio_key != '' THEN 1 ELSE 0 END) AS musical_key,
                    SUM(CASE WHEN energy IS NOT NULL THEN 1 ELSE 0 END) AS energy,
                    SUM(CASE WHEN danceability IS NOT NULL THEN 1 ELSE 0 END) AS danceability,
                    SUM(CASE WHEN acousticness IS NOT NULL THEN 1 ELSE 0 END) AS acousticness,
                    SUM(CASE WHEN instrumentalness IS NOT NULL THEN 1 ELSE 0 END) AS instrumentalness,
                    SUM(CASE WHEN mood_json IS NOT NULL AND mood_json::text != '{}' THEN 1 ELSE 0 END) AS mood,
                    SUM(CASE WHEN bliss_vector IS NOT NULL THEN 1 ELSE 0 END) AS bliss
                FROM library_tracks
                """
            )
        ).mappings().first()

    total = int((row or {}).get("total") or 0)
    features = [
        ("BPM", int((row or {}).get("bpm") or 0)),
        ("Key", int((row or {}).get("musical_key") or 0)),
        ("Energy", int((row or {}).get("energy") or 0)),
        ("Danceability", int((row or {}).get("danceability") or 0)),
        ("Acousticness", int((row or {}).get("acousticness") or 0)),
        ("Instrumentalness", int((row or {}).get("instrumentalness") or 0)),
        ("Mood", int((row or {}).get("mood") or 0)),
        ("Bliss", int((row or {}).get("bliss") or 0)),
    ]
    return [{"feature": feature, "value": value, "total": total} for feature, value in features]


def get_insights_mood_distribution() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    expanded.mood,
                    ROUND(SUM(expanded.score)::numeric, 1) AS score
                FROM (
                    SELECT
                        moods.key AS mood,
                        CASE
                            WHEN jsonb_typeof(moods.value) = 'number'
                            THEN (moods.value #>> '{}')::double precision
                            ELSE NULL
                        END AS score
                    FROM library_tracks lt
                    LEFT JOIN track_analysis_features taf ON taf.track_id = lt.id
                    CROSS JOIN LATERAL jsonb_each(
                        COALESCE(taf.mood_json, lt.mood_json, '{}'::jsonb)
                    ) AS moods(key, value)
                ) AS expanded
                WHERE expanded.score IS NOT NULL
                GROUP BY expanded.mood
                ORDER BY SUM(expanded.score) DESC, expanded.mood ASC
                LIMIT 12
                """
            )
        ).mappings().all()

    return [
        {"mood": str(row.get("mood") or ""), "score": float(row.get("score") or 0.0)}
        for row in rows
        if row.get("mood")
    ]


__all__ = [
    "get_insights_feature_coverage",
    "get_insights_mood_distribution",
]
