from __future__ import annotations

import json

from sqlalchemy import text

from crate.db.tx import read_scope


def get_insights_countries() -> dict[str, int]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT country, COUNT(*) AS cnt
                FROM library_artists WHERE country IS NOT NULL AND country != ''
                GROUP BY country ORDER BY cnt DESC
                """
            )
        ).mappings().all()
        return {r["country"]: r["cnt"] for r in rows}


def get_insights_bpm_distribution() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT FLOOR(bpm / 10) * 10 AS bucket, COUNT(*) AS cnt
                FROM library_tracks WHERE bpm IS NOT NULL
                GROUP BY bucket ORDER BY bucket
                """
            )
        ).mappings().all()
        return [{"bpm": f"{int(r['bucket'])}-{int(r['bucket'])+9}", "count": r["cnt"]} for r in rows]


def get_insights_key_distribution() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT audio_key, audio_scale, COUNT(*) AS cnt
                FROM library_tracks WHERE audio_key IS NOT NULL AND audio_key != ''
                GROUP BY audio_key, audio_scale ORDER BY cnt DESC
                """
            )
        ).mappings().all()
        return [{"key": f"{r['audio_key']} {r['audio_scale'] or ''}".strip(), "count": r["cnt"]} for r in rows]


def get_insights_energy_danceability(limit: int = 500) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT energy, danceability, artist, title
                FROM library_tracks
                WHERE energy IS NOT NULL AND danceability IS NOT NULL
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
        return [{"x": round(r["energy"], 2), "y": round(r["danceability"], 2), "artist": r["artist"], "title": r["title"]} for r in rows]


def get_insights_format_distribution() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT format, COUNT(*) AS cnt FROM library_tracks
                WHERE format IS NOT NULL GROUP BY format ORDER BY cnt DESC
                """
            )
        ).mappings().all()
        return [{"id": r["format"], "value": r["cnt"]} for r in rows]


def get_insights_bitrate_distribution() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT CASE
                    WHEN bitrate IS NULL THEN 'Unknown'
                    WHEN bitrate > 900000 THEN 'Lossless'
                    WHEN bitrate > 256000 THEN '320k'
                    WHEN bitrate > 192000 THEN '256k'
                    WHEN bitrate > 128000 THEN '192k'
                    ELSE '128k-'
                END AS bracket, COUNT(*) AS cnt
                FROM library_tracks GROUP BY bracket ORDER BY cnt DESC
                """
            )
        ).mappings().all()
        return [{"id": r["bracket"], "value": r["cnt"]} for r in rows]


def get_insights_top_genres(limit: int = 20) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT g.name, COUNT(DISTINCT ag.artist_name) AS artists, COUNT(DISTINCT alg.album_id) AS albums
                FROM genres g
                LEFT JOIN artist_genres ag ON g.id = ag.genre_id
                LEFT JOIN album_genres alg ON g.id = alg.genre_id
                GROUP BY g.id, g.name
                HAVING COUNT(DISTINCT ag.artist_name) > 0
                ORDER BY COUNT(DISTINCT ag.artist_name) DESC LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
        return [{"genre": r["name"], "artists": r["artists"], "albums": r["albums"]} for r in rows]


def get_insights_popularity(limit: int = 20) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    la.name,
                    la.popularity,
                    la.popularity_score,
                    la.listeners,
                    COUNT(DISTINCT alb.id) AS albums
                FROM library_artists la
                LEFT JOIN library_albums alb ON alb.artist = la.name
                WHERE (la.popularity_score IS NOT NULL AND la.popularity_score > 0)
                   OR (la.popularity IS NOT NULL AND la.popularity > 0)
                   OR (la.listeners IS NOT NULL AND la.listeners > 0)
                GROUP BY la.id, la.name, la.popularity, la.popularity_score, la.listeners
                ORDER BY la.popularity_score DESC NULLS LAST, la.popularity DESC NULLS LAST, la.listeners DESC NULLS LAST
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
        results = []
        for row in rows:
            popularity_score = row.get("popularity_score")
            popularity = row.get("popularity")
            listeners = row.get("listeners") or 0
            results.append(
                {
                    "artist": row["name"],
                    "popularity": popularity if popularity is not None else min(100, listeners // 10000),
                    "popularity_score": round(popularity_score, 4) if popularity_score is not None else None,
                    "listeners": listeners,
                    "albums": row.get("albums") or 0,
                }
            )
        return results


def get_insights_albums_by_year() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT year, COUNT(*) AS cnt FROM library_albums
                WHERE year IS NOT NULL AND year != '' GROUP BY year ORDER BY year
                """
            )
        ).mappings().all()
        return [dict(r) for r in rows]


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
        for r in rows:
            moods = r["mood_json"]
            if isinstance(moods, str):
                moods = json.loads(moods) if moods else {}
            if isinstance(moods, dict):
                for mood, score in moods.items():
                    mood_counts[mood] = mood_counts.get(mood, 0) + (score if isinstance(score, (int, float)) else 0)
        top_moods = sorted(mood_counts.items(), key=lambda x: x[1], reverse=True)[:12]
        return [{"mood": m, "score": round(s, 1)} for m, s in top_moods]


def get_insights_loudness_distribution() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT FLOOR(loudness / 3) * 3 AS bucket, COUNT(*) AS cnt
                FROM library_tracks WHERE loudness IS NOT NULL
                GROUP BY bucket ORDER BY bucket
                """
            )
        ).mappings().all()
        return [{"db": f"{int(r['bucket'])} dB", "count": r["cnt"]} for r in rows]


def get_insights_top_albums(limit: int = 20) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT name, artist, lastfm_listeners, popularity, popularity_score, year
                FROM library_albums
                WHERE (popularity_score IS NOT NULL AND popularity_score > 0)
                   OR (lastfm_listeners IS NOT NULL AND lastfm_listeners > 0)
                ORDER BY popularity_score DESC NULLS LAST, lastfm_listeners DESC NULLS LAST
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
        return [dict(r) for r in rows]


def get_insights_acoustic_instrumental(limit: int = 500) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT acousticness, instrumentalness, artist, title
                FROM library_tracks
                WHERE acousticness IS NOT NULL AND instrumentalness IS NOT NULL
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()
        return [{"x": round(r["acousticness"], 2), "y": round(r["instrumentalness"], 2), "artist": r["artist"], "title": r["title"]} for r in rows]


def get_insights_artist_depth(limit: int = 120) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    la.name,
                    la.popularity,
                    la.popularity_score,
                    la.listeners,
                    COUNT(DISTINCT alb.id) AS albums,
                    COUNT(DISTINCT t.id) AS tracks
                FROM library_artists la
                LEFT JOIN library_albums alb ON alb.artist = la.name
                LEFT JOIN library_tracks t ON t.album_id = alb.id
                GROUP BY la.id, la.name, la.popularity, la.popularity_score, la.listeners
                HAVING COUNT(DISTINCT alb.id) > 0
                ORDER BY la.popularity_score DESC NULLS LAST, la.popularity DESC NULLS LAST, la.listeners DESC NULLS LAST
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings().all()

        results = []
        for row in rows:
            popularity_score = row.get("popularity_score")
            popularity = row.get("popularity")
            listeners = row.get("listeners") or 0
            results.append(
                {
                    "artist": row["name"],
                    "popularity": popularity if popularity is not None else min(100, listeners // 10000),
                    "popularity_score": round(popularity_score, 4) if popularity_score is not None else None,
                    "listeners": listeners,
                    "albums": row.get("albums") or 0,
                    "tracks": row.get("tracks") or 0,
                }
            )
        return results


__all__ = [
    "get_insights_acoustic_instrumental",
    "get_insights_albums_by_year",
    "get_insights_artist_depth",
    "get_insights_bitrate_distribution",
    "get_insights_bpm_distribution",
    "get_insights_countries",
    "get_insights_energy_danceability",
    "get_insights_feature_coverage",
    "get_insights_format_distribution",
    "get_insights_key_distribution",
    "get_insights_loudness_distribution",
    "get_insights_mood_distribution",
    "get_insights_popularity",
    "get_insights_top_albums",
    "get_insights_top_genres",
]
