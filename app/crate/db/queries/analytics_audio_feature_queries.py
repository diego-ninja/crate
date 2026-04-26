from __future__ import annotations

import json

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
                SELECT mood_json FROM library_tracks
                WHERE mood_json IS NOT NULL AND mood_json::text != '{}'
                """
            )
        ).mappings().all()

    mood_counts: dict[str, float] = {}
    for row in rows:
        moods = row["mood_json"]
        if isinstance(moods, str):
            moods = json.loads(moods) if moods else {}
        if isinstance(moods, dict):
            for mood, score in moods.items():
                mood_counts[mood] = mood_counts.get(mood, 0) + (score if isinstance(score, (int, float)) else 0)
    top_moods = sorted(mood_counts.items(), key=lambda item: item[1], reverse=True)[:12]
    return [{"mood": mood, "score": round(score, 1)} for mood, score in top_moods]


__all__ = [
    "get_insights_feature_coverage",
    "get_insights_mood_distribution",
]
