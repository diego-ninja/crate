import json
import logging

from crate.db.tx import transaction_scope
from sqlalchemy import text

log = logging.getLogger(__name__)


def get_genre_distribution(limit: int = 30) -> dict[str, int]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT genre, COUNT(*) as c FROM library_tracks WHERE genre IS NOT NULL AND genre != '' GROUP BY genre ORDER BY c DESC LIMIT 30")
        ).mappings().all()
        return {r["genre"]: r["c"] for r in rows}


def get_decade_distribution() -> dict[str, int]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT (CAST(year AS INTEGER)/10)*10 || 's' as decade, COUNT(*) as c "
                 "FROM library_albums WHERE year IS NOT NULL AND year != '' AND length(year) >= 4 "
                 "GROUP BY decade ORDER BY decade")
        ).mappings().all()
        return {r["decade"]: r["c"] for r in rows}


def get_format_distribution() -> dict[str, int]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT format, COUNT(*) as c FROM library_tracks WHERE format IS NOT NULL GROUP BY format")
        ).mappings().all()
        return {r["format"]: r["c"] for r in rows}


def get_bitrate_distribution() -> dict[str, int]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT
                CASE
                    WHEN bitrate IS NULL OR bitrate = 0 THEN 'unknown'
                    WHEN bitrate < 128000 THEN '<128k'
                    WHEN bitrate < 192000 THEN '128-191k'
                    WHEN bitrate < 256000 THEN '192-255k'
                    WHEN bitrate < 320000 THEN '256-319k'
                    WHEN bitrate = 320000 THEN '320k'
                    ELSE '>320k'
                END as bucket,
                COUNT(*) as c
            FROM library_tracks GROUP BY 1 ORDER BY 1
        """)).mappings().all()
        return {r["bucket"]: r["c"] for r in rows}


def get_top_artists_by_albums(limit: int = 25) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT la.id, la.slug, la.name, COUNT(DISTINCT alb.id) AS albums
            FROM library_artists la
            JOIN library_albums alb ON alb.artist = la.name
            GROUP BY la.id, la.slug, la.name
            ORDER BY albums DESC
            LIMIT 25
        """)).mappings().all()
        return [{"id": r["id"], "slug": r["slug"], "name": r["name"], "albums": r["albums"]} for r in rows]


def get_total_duration_hours() -> float:
    with transaction_scope() as session:
        dur_row = session.execute(text("SELECT COALESCE(SUM(duration), 0) as total FROM library_tracks")).mappings().first()
        return round(dur_row["total"] / 3600, 1) if dur_row["total"] else 0


def get_sizes_by_format_gb() -> dict[str, float]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT format, SUM(size) as total FROM library_tracks WHERE format IS NOT NULL GROUP BY format")
        ).mappings().all()
        return {r["format"]: round(r["total"] / (1024**3), 2) for r in rows if r["total"]}


def get_avg_tracks_per_album() -> float:
    with transaction_scope() as session:
        album_count = session.execute(text("SELECT COUNT(*) AS cnt FROM library_albums")).mappings().first()["cnt"]
        track_count = session.execute(text("SELECT COUNT(*) AS cnt FROM library_tracks")).mappings().first()["cnt"]
        return round(track_count / album_count, 1) if album_count else 0


# ── Stats endpoint queries ──────────────────────────────────────

def get_stats_duration_hours() -> float:
    with transaction_scope() as session:
        row = session.execute(text("SELECT COALESCE(SUM(duration), 0) / 3600.0 AS val FROM library_tracks")).mappings().first()
        return round(row["val"], 1)


def get_stats_avg_bitrate() -> int:
    with transaction_scope() as session:
        row = session.execute(text("SELECT AVG(bitrate) AS val FROM library_tracks WHERE bitrate IS NOT NULL")).mappings().first()
        return round(row["val"]) if row["val"] else 0


def get_stats_top_genres(limit: int = 10) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT genre, COUNT(*) AS c FROM library_tracks "
                 "WHERE genre IS NOT NULL AND genre != '' "
                 "GROUP BY genre ORDER BY c DESC LIMIT 10")
        ).mappings().all()
        return [{"name": r["genre"], "count": r["c"]} for r in rows]


def get_stats_recent_albums(limit: int = 10) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT a.id, a.slug, a.artist, ar.id AS artist_id, ar.slug AS artist_slug, a.name, a.year, a.dir_mtime FROM library_albums a "
                 "LEFT JOIN library_artists ar ON ar.name = a.artist "
                 "ORDER BY dir_mtime DESC NULLS LAST LIMIT 10")
        ).mappings().all()
        return [dict(r) for r in rows]


def get_stats_analyzed_track_count() -> int:
    with transaction_scope() as session:
        return session.execute(text("SELECT COUNT(*) AS c FROM library_tracks WHERE bpm IS NOT NULL")).mappings().first()["c"]


def get_stats_avg_album_duration_min() -> float:
    with transaction_scope() as session:
        row = session.execute(text("SELECT AVG(total_duration) AS val FROM library_albums WHERE total_duration IS NOT NULL AND total_duration > 0")).mappings().first()
        return round(row["val"] / 60, 1) if row and row["val"] else 0


# ── Timeline endpoint ───────────────────────────────────────────

def get_timeline_albums() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT
                a.id,
                a.slug,
                a.year,
                a.artist,
                ar.id AS artist_id,
                ar.slug AS artist_slug,
                a.name,
                a.track_count
            FROM library_albums a
            LEFT JOIN library_artists ar ON ar.name = a.artist
            WHERE a.year IS NOT NULL AND a.year != ''
            ORDER BY a.year
        """)).mappings().all()
        return [dict(r) for r in rows]


# ── Artist stats ────────────────────────────────────────────────

def get_artist_format_distribution(artist_name: str) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT t.format, COUNT(*) AS cnt FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE a.artist = :artist_name AND t.format IS NOT NULL
            GROUP BY t.format ORDER BY cnt DESC
        """), {"artist_name": artist_name}).mappings().all()
        return [{"id": r["format"], "value": r["cnt"]} for r in rows]


def get_artist_albums_timeline(artist_name: str) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT name, year, track_count, total_duration, lastfm_listeners, popularity
            FROM library_albums WHERE artist = :artist_name ORDER BY year
        """), {"artist_name": artist_name}).mappings().all()
        return [dict(r) for r in rows]


def get_artist_audio_by_album(artist_name: str) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT a.name AS album,
                   AVG(t.bpm) AS avg_bpm,
                   AVG(t.energy) AS avg_energy,
                   AVG(t.danceability) AS avg_danceability,
                   AVG(t.valence) AS avg_valence,
                   AVG(t.acousticness) AS avg_acousticness,
                   AVG(t.loudness) AS avg_loudness
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE a.artist = :artist_name AND t.bpm IS NOT NULL
            GROUP BY a.name, a.year ORDER BY a.year
        """), {"artist_name": artist_name}).mappings().all()
        results = []
        for r in rows:
            d = dict(r)
            for k in ("avg_bpm", "avg_energy", "avg_danceability", "avg_valence", "avg_acousticness", "avg_loudness"):
                if d.get(k) is not None:
                    d[k] = round(d[k], 2)
            results.append(d)
        return results


def get_artist_top_tracks(artist_name: str, limit: int = 10) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT
                t.title,
                t.album,
                t.duration,
                t.popularity,
                t.popularity_score,
                t.lastfm_listeners,
                t.bpm,
                t.energy
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE a.artist = :artist_name AND (t.popularity_score IS NOT NULL OR t.popularity IS NOT NULL)
            ORDER BY t.popularity_score DESC NULLS LAST, t.popularity DESC NULLS LAST LIMIT 10
        """), {"artist_name": artist_name}).mappings().all()
        return [dict(r) for r in rows]


def get_artist_genre_tags(artist_name: str) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT g.name, ag.weight FROM artist_genres ag
            JOIN genres g ON ag.genre_id = g.id
            WHERE ag.artist_name = :artist_name ORDER BY ag.weight DESC
        """), {"artist_name": artist_name}).mappings().all()
        return [{"name": r["name"], "weight": round(r["weight"], 2)} for r in rows]


# ── Insights endpoint ───────────────────────────────────────────

def get_insights_countries() -> dict[str, int]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT country, COUNT(*) AS cnt
            FROM library_artists WHERE country IS NOT NULL AND country != ''
            GROUP BY country ORDER BY cnt DESC
        """)).mappings().all()
        return {r["country"]: r["cnt"] for r in rows}


def get_insights_bpm_distribution() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT FLOOR(bpm / 10) * 10 AS bucket, COUNT(*) AS cnt
            FROM library_tracks WHERE bpm IS NOT NULL
            GROUP BY bucket ORDER BY bucket
        """)).mappings().all()
        return [{"bpm": f"{int(r['bucket'])}-{int(r['bucket'])+9}", "count": r["cnt"]} for r in rows]


def get_insights_key_distribution() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT audio_key, audio_scale, COUNT(*) AS cnt
            FROM library_tracks WHERE audio_key IS NOT NULL AND audio_key != ''
            GROUP BY audio_key, audio_scale ORDER BY cnt DESC
        """)).mappings().all()
        return [{"key": f"{r['audio_key']} {r['audio_scale'] or ''}".strip(), "count": r["cnt"]} for r in rows]


def get_insights_energy_danceability(limit: int = 500) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT energy, danceability, artist, title
            FROM library_tracks
            WHERE energy IS NOT NULL AND danceability IS NOT NULL
            LIMIT 500
        """)).mappings().all()
        return [{"x": round(r["energy"], 2), "y": round(r["danceability"], 2),
                 "artist": r["artist"], "title": r["title"]} for r in rows]


def get_insights_format_distribution() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT format, COUNT(*) AS cnt FROM library_tracks
            WHERE format IS NOT NULL GROUP BY format ORDER BY cnt DESC
        """)).mappings().all()
        return [{"id": r["format"], "value": r["cnt"]} for r in rows]


def get_insights_bitrate_distribution() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT CASE
                WHEN bitrate IS NULL THEN 'Unknown'
                WHEN bitrate > 900000 THEN 'Lossless'
                WHEN bitrate > 256000 THEN '320k'
                WHEN bitrate > 192000 THEN '256k'
                WHEN bitrate > 128000 THEN '192k'
                ELSE '128k-'
            END AS bracket, COUNT(*) AS cnt
            FROM library_tracks GROUP BY bracket ORDER BY cnt DESC
        """)).mappings().all()
        return [{"id": r["bracket"], "value": r["cnt"]} for r in rows]


def get_insights_top_genres(limit: int = 20) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT g.name, COUNT(DISTINCT ag.artist_name) AS artists, COUNT(DISTINCT alg.album_id) AS albums
            FROM genres g
            LEFT JOIN artist_genres ag ON g.id = ag.genre_id
            LEFT JOIN album_genres alg ON g.id = alg.genre_id
            GROUP BY g.id, g.name
            HAVING COUNT(DISTINCT ag.artist_name) > 0
            ORDER BY COUNT(DISTINCT ag.artist_name) DESC LIMIT 20
        """)).mappings().all()
        return [{"genre": r["name"], "artists": r["artists"], "albums": r["albums"]} for r in rows]


def get_insights_popularity(limit: int = 20) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
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
            LIMIT 20
        """)).mappings().all()
        results = []
        for row in rows:
            popularity_score = row.get("popularity_score")
            popularity = row.get("popularity")
            listeners = row.get("listeners") or 0
            results.append({
                "artist": row["name"],
                "popularity": popularity if popularity is not None else min(100, listeners // 10000),
                "popularity_score": round(popularity_score, 4) if popularity_score is not None else None,
                "listeners": listeners,
                "albums": row.get("albums") or 0,
            })
        return results


def get_insights_albums_by_year() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT year, COUNT(*) AS cnt FROM library_albums
            WHERE year IS NOT NULL AND year != '' GROUP BY year ORDER BY year
        """)).mappings().all()
        return [dict(r) for r in rows]


def get_insights_feature_coverage() -> list[dict]:
    with transaction_scope() as session:
        row = session.execute(text("""
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
        """)).mappings().first()

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
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT mood_json FROM library_tracks
            WHERE mood_json IS NOT NULL AND mood_json::text != '{}'
        """)).mappings().all()
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
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT FLOOR(loudness / 3) * 3 AS bucket, COUNT(*) AS cnt
            FROM library_tracks WHERE loudness IS NOT NULL
            GROUP BY bucket ORDER BY bucket
        """)).mappings().all()
        return [{"db": f"{int(r['bucket'])} dB", "count": r["cnt"]} for r in rows]


def get_insights_top_albums(limit: int = 20) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT name, artist, lastfm_listeners, popularity, popularity_score, year
            FROM library_albums
            WHERE (popularity_score IS NOT NULL AND popularity_score > 0)
               OR (lastfm_listeners IS NOT NULL AND lastfm_listeners > 0)
            ORDER BY popularity_score DESC NULLS LAST, lastfm_listeners DESC NULLS LAST
            LIMIT :limit
        """), {"limit": limit}).mappings().all()
        return [dict(r) for r in rows]


def get_insights_acoustic_instrumental(limit: int = 500) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT acousticness, instrumentalness, artist, title
            FROM library_tracks
            WHERE acousticness IS NOT NULL AND instrumentalness IS NOT NULL
            LIMIT 500
        """)).mappings().all()
        return [{"x": round(r["acousticness"], 2), "y": round(r["instrumentalness"], 2),
                 "artist": r["artist"], "title": r["title"]} for r in rows]


def get_insights_artist_depth(limit: int = 120) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
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
        """), {"limit": limit}).mappings().all()

        results = []
        for row in rows:
            popularity_score = row.get("popularity_score")
            popularity = row.get("popularity")
            listeners = row.get("listeners") or 0
            results.append({
                "artist": row["name"],
                "popularity": popularity if popularity is not None else min(100, listeners // 10000),
                "popularity_score": round(popularity_score, 4) if popularity_score is not None else None,
                "listeners": listeners,
                "albums": row.get("albums") or 0,
                "tracks": row.get("tracks") or 0,
            })
        return results
