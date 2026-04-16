import json
import logging

from crate.db.core import get_db_ctx

log = logging.getLogger(__name__)


def get_genre_distribution(limit: int = 30) -> dict[str, int]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT genre, COUNT(*) as c FROM library_tracks WHERE genre IS NOT NULL AND genre != '' GROUP BY genre ORDER BY c DESC LIMIT 30"
        )
        return {r["genre"]: r["c"] for r in cur.fetchall()}


def get_decade_distribution() -> dict[str, int]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT (CAST(year AS INTEGER)/10)*10 || 's' as decade, COUNT(*) as c "
            "FROM library_albums WHERE year IS NOT NULL AND year != '' AND length(year) >= 4 "
            "GROUP BY decade ORDER BY decade"
        )
        return {r["decade"]: r["c"] for r in cur.fetchall()}


def get_format_distribution() -> dict[str, int]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT format, COUNT(*) as c FROM library_tracks WHERE format IS NOT NULL GROUP BY format"
        )
        return {r["format"]: r["c"] for r in cur.fetchall()}


def get_bitrate_distribution() -> dict[str, int]:
    with get_db_ctx() as cur:
        cur.execute("""
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
        """)
        return {r["bucket"]: r["c"] for r in cur.fetchall()}


def get_top_artists_by_albums(limit: int = 25) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT la.id, la.slug, la.name, COUNT(DISTINCT alb.id) AS albums
            FROM library_artists la
            JOIN library_albums alb ON alb.artist = la.name
            GROUP BY la.id, la.slug, la.name
            ORDER BY albums DESC
            LIMIT 25
            """
        )
        return [{"id": r["id"], "slug": r["slug"], "name": r["name"], "albums": r["albums"]} for r in cur.fetchall()]


def get_total_duration_hours() -> float:
    with get_db_ctx() as cur:
        cur.execute("SELECT COALESCE(SUM(duration), 0) as total FROM library_tracks")
        dur_row = cur.fetchone()
        return round(dur_row["total"] / 3600, 1) if dur_row["total"] else 0


def get_sizes_by_format_gb() -> dict[str, float]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT format, SUM(size) as total FROM library_tracks WHERE format IS NOT NULL GROUP BY format"
        )
        return {r["format"]: round(r["total"] / (1024**3), 2) for r in cur.fetchall() if r["total"]}


def get_avg_tracks_per_album() -> float:
    with get_db_ctx() as cur:
        cur.execute("SELECT COUNT(*) AS cnt FROM library_albums")
        album_count = cur.fetchone()["cnt"]
        cur.execute("SELECT COUNT(*) AS cnt FROM library_tracks")
        track_count = cur.fetchone()["cnt"]
        return round(track_count / album_count, 1) if album_count else 0


# ── Stats endpoint queries ──────────────────────────────────────

def get_stats_duration_hours() -> float:
    with get_db_ctx() as cur:
        cur.execute("SELECT COALESCE(SUM(duration), 0) / 3600.0 AS val FROM library_tracks")
        return round(cur.fetchone()["val"], 1)


def get_stats_avg_bitrate() -> int:
    with get_db_ctx() as cur:
        cur.execute("SELECT AVG(bitrate) AS val FROM library_tracks WHERE bitrate IS NOT NULL")
        row = cur.fetchone()
        return round(row["val"]) if row["val"] else 0


def get_stats_top_genres(limit: int = 10) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT genre, COUNT(*) AS c FROM library_tracks "
            "WHERE genre IS NOT NULL AND genre != '' "
            "GROUP BY genre ORDER BY c DESC LIMIT 10"
        )
        return [{"name": r["genre"], "count": r["c"]} for r in cur.fetchall()]


def get_stats_recent_albums(limit: int = 10) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT a.id, a.slug, a.artist, ar.id AS artist_id, ar.slug AS artist_slug, a.name, a.year, a.dir_mtime FROM library_albums a "
            "LEFT JOIN library_artists ar ON ar.name = a.artist "
            "ORDER BY dir_mtime DESC NULLS LAST LIMIT 10"
        )
        return [dict(r) for r in cur.fetchall()]


def get_stats_analyzed_track_count() -> int:
    with get_db_ctx() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM library_tracks WHERE bpm IS NOT NULL")
        return cur.fetchone()["c"]


def get_stats_avg_album_duration_min() -> float:
    with get_db_ctx() as cur:
        cur.execute("SELECT AVG(total_duration) AS val FROM library_albums WHERE total_duration IS NOT NULL AND total_duration > 0")
        row = cur.fetchone()
        return round(row["val"] / 60, 1) if row and row["val"] else 0


# ── Timeline endpoint ───────────────────────────────────────────

def get_timeline_albums() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            """
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
            """
        )
        return [dict(r) for r in cur.fetchall()]


# ── Artist stats ────────────────────────────────────────────────

def get_artist_format_distribution(artist_name: str) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT t.format, COUNT(*) AS cnt FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE a.artist = %s AND t.format IS NOT NULL
            GROUP BY t.format ORDER BY cnt DESC
        """, (artist_name,))
        return [{"id": r["format"], "value": r["cnt"]} for r in cur.fetchall()]


def get_artist_albums_timeline(artist_name: str) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT name, year, track_count, total_duration, lastfm_listeners, popularity
            FROM library_albums WHERE artist = %s ORDER BY year
        """, (artist_name,))
        return [dict(r) for r in cur.fetchall()]


def get_artist_audio_by_album(artist_name: str) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT a.name AS album,
                   AVG(t.bpm) AS avg_bpm,
                   AVG(t.energy) AS avg_energy,
                   AVG(t.danceability) AS avg_danceability,
                   AVG(t.valence) AS avg_valence,
                   AVG(t.acousticness) AS avg_acousticness,
                   AVG(t.loudness) AS avg_loudness
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE a.artist = %s AND t.bpm IS NOT NULL
            GROUP BY a.name, a.year ORDER BY a.year
        """, (artist_name,))
        results = []
        for r in cur.fetchall():
            d = dict(r)
            for k in ("avg_bpm", "avg_energy", "avg_danceability", "avg_valence", "avg_acousticness", "avg_loudness"):
                if d.get(k) is not None:
                    d[k] = round(d[k], 2)
            results.append(d)
        return results


def get_artist_top_tracks(artist_name: str, limit: int = 10) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT t.title, t.album, t.duration, t.popularity, t.lastfm_listeners, t.bpm, t.energy
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE a.artist = %s AND t.popularity IS NOT NULL
            ORDER BY t.popularity DESC LIMIT 10
        """, (artist_name,))
        return [dict(r) for r in cur.fetchall()]


def get_artist_genre_tags(artist_name: str) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT g.name, ag.weight FROM artist_genres ag
            JOIN genres g ON ag.genre_id = g.id
            WHERE ag.artist_name = %s ORDER BY ag.weight DESC
        """, (artist_name,))
        return [{"name": r["name"], "weight": round(r["weight"], 2)} for r in cur.fetchall()]


# ── Insights endpoint ───────────────────────────────────────────

def get_insights_countries() -> dict[str, int]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT country, COUNT(*) AS cnt
            FROM library_artists WHERE country IS NOT NULL AND country != ''
            GROUP BY country ORDER BY cnt DESC
        """)
        return {r["country"]: r["cnt"] for r in cur.fetchall()}


def get_insights_formation_years() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT formed FROM library_artists WHERE formed IS NOT NULL AND formed != ''
        """)
        return [dict(r) for r in cur.fetchall()]


def get_insights_bpm_distribution() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT FLOOR(bpm / 10) * 10 AS bucket, COUNT(*) AS cnt
            FROM library_tracks WHERE bpm IS NOT NULL
            GROUP BY bucket ORDER BY bucket
        """)
        return [{"bpm": f"{int(r['bucket'])}-{int(r['bucket'])+9}", "count": r["cnt"]} for r in cur.fetchall()]


def get_insights_key_distribution() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT audio_key, audio_scale, COUNT(*) AS cnt
            FROM library_tracks WHERE audio_key IS NOT NULL AND audio_key != ''
            GROUP BY audio_key, audio_scale ORDER BY cnt DESC
        """)
        return [{"key": f"{r['audio_key']} {r['audio_scale'] or ''}".strip(), "count": r["cnt"]} for r in cur.fetchall()]


def get_insights_energy_danceability(limit: int = 500) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT energy, danceability, artist, title
            FROM library_tracks
            WHERE energy IS NOT NULL AND danceability IS NOT NULL
            LIMIT 500
        """)
        return [{"x": round(r["energy"], 2), "y": round(r["danceability"], 2),
                 "artist": r["artist"], "title": r["title"]} for r in cur.fetchall()]


def get_insights_format_distribution() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT format, COUNT(*) AS cnt FROM library_tracks
            WHERE format IS NOT NULL GROUP BY format ORDER BY cnt DESC
        """)
        return [{"id": r["format"], "value": r["cnt"]} for r in cur.fetchall()]


def get_insights_bitrate_distribution() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT CASE
                WHEN bitrate IS NULL THEN 'Unknown'
                WHEN bitrate > 900000 THEN 'Lossless'
                WHEN bitrate > 256000 THEN '320k'
                WHEN bitrate > 192000 THEN '256k'
                WHEN bitrate > 128000 THEN '192k'
                ELSE '128k-'
            END AS bracket, COUNT(*) AS cnt
            FROM library_tracks GROUP BY bracket ORDER BY cnt DESC
        """)
        return [{"id": r["bracket"], "value": r["cnt"]} for r in cur.fetchall()]


def get_insights_top_genres(limit: int = 20) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT g.name, COUNT(DISTINCT ag.artist_name) AS artists, COUNT(DISTINCT alg.album_id) AS albums
            FROM genres g
            LEFT JOIN artist_genres ag ON g.id = ag.genre_id
            LEFT JOIN album_genres alg ON g.id = alg.genre_id
            GROUP BY g.id, g.name
            HAVING COUNT(DISTINCT ag.artist_name) > 0
            ORDER BY COUNT(DISTINCT ag.artist_name) DESC LIMIT 20
        """)
        return [{"genre": r["name"], "artists": r["artists"], "albums": r["albums"]} for r in cur.fetchall()]


def get_insights_similar_network() -> tuple[list[dict], list[dict]]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT name, similar_json, listeners, spotify_popularity
            FROM library_artists WHERE similar_json IS NOT NULL
        """)
        network_nodes = []
        network_links = []
        artist_set = set()
        for r in cur.fetchall():
            name = r["name"]
            similar = r["similar_json"]
            if isinstance(similar, str):
                similar = json.loads(similar) if similar else []
            if not similar:
                continue
            artist_set.add(name)
            for s in similar[:10]:
                s_name = s.get("name", "") if isinstance(s, dict) else str(s)
                if s_name:
                    artist_set.add(s_name)
                    network_links.append({"source": name, "target": s_name})
        for a in artist_set:
            network_nodes.append({"id": a})
        return network_nodes, network_links


def get_insights_popularity(limit: int = 20) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT name, spotify_popularity, listeners
            FROM library_artists
            WHERE (spotify_popularity IS NOT NULL AND spotify_popularity > 0)
               OR (listeners IS NOT NULL AND listeners > 0)
            ORDER BY COALESCE(spotify_popularity, 0) DESC, COALESCE(listeners, 0) DESC
            LIMIT 20
        """)
        return [{"artist": r["name"],
                 "popularity": r["spotify_popularity"] or (min(100, (r["listeners"] or 0) // 10000)),
                 "listeners": r["listeners"] or 0} for r in cur.fetchall()]


def get_insights_albums_by_year() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT year, COUNT(*) AS cnt FROM library_albums
            WHERE year IS NOT NULL AND year != '' GROUP BY year ORDER BY year
        """)
        return [dict(r) for r in cur.fetchall()]


def get_insights_completeness() -> dict:
    with get_db_ctx() as cur:
        cur.execute("SELECT COUNT(*) AS total, SUM(CASE WHEN has_photo = 1 THEN 1 ELSE 0 END) AS with_photo, SUM(CASE WHEN enriched_at IS NOT NULL THEN 1 ELSE 0 END) AS enriched FROM library_artists")
        completeness_row = cur.fetchone()
        cur.execute("SELECT COUNT(*) AS total, SUM(CASE WHEN has_cover = 1 THEN 1 ELSE 0 END) AS with_cover FROM library_albums")
        cover_row = cur.fetchone()
        cur.execute("SELECT COUNT(*) AS total, SUM(CASE WHEN bpm IS NOT NULL THEN 1 ELSE 0 END) AS analyzed FROM library_tracks")
        analysis_row = cur.fetchone()

        return {
            "artists_total": completeness_row["total"],
            "artists_with_photo": completeness_row["with_photo"],
            "artists_enriched": completeness_row["enriched"],
            "albums_total": cover_row["total"],
            "albums_with_cover": cover_row["with_cover"],
            "tracks_total": analysis_row["total"],
            "tracks_analyzed": analysis_row["analyzed"],
        }


def get_insights_mood_distribution() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT mood_json FROM library_tracks
            WHERE mood_json IS NOT NULL AND mood_json::text != '{}'
        """)
        mood_counts: dict[str, float] = {}
        for r in cur.fetchall():
            moods = r["mood_json"]
            if isinstance(moods, str):
                moods = json.loads(moods) if moods else {}
            if isinstance(moods, dict):
                for mood, score in moods.items():
                    mood_counts[mood] = mood_counts.get(mood, 0) + (score if isinstance(score, (int, float)) else 0)
        top_moods = sorted(mood_counts.items(), key=lambda x: x[1], reverse=True)[:12]
        return [{"mood": m, "score": round(s, 1)} for m, s in top_moods]


def get_insights_loudness_distribution() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT FLOOR(loudness / 3) * 3 AS bucket, COUNT(*) AS cnt
            FROM library_tracks WHERE loudness IS NOT NULL
            GROUP BY bucket ORDER BY bucket
        """)
        return [{"db": f"{int(r['bucket'])} dB", "count": r["cnt"]} for r in cur.fetchall()]


def get_insights_top_albums(limit: int = 20) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT name, artist, lastfm_listeners, popularity, year
            FROM library_albums
            WHERE lastfm_listeners IS NOT NULL AND lastfm_listeners > 0
            ORDER BY lastfm_listeners DESC LIMIT 20
        """)
        return [dict(r) for r in cur.fetchall()]


def get_insights_acoustic_instrumental(limit: int = 500) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT acousticness, instrumentalness, artist, title
            FROM library_tracks
            WHERE acousticness IS NOT NULL AND instrumentalness IS NOT NULL
            LIMIT 500
        """)
        return [{"x": round(r["acousticness"], 2), "y": round(r["instrumentalness"], 2),
                 "artist": r["artist"], "title": r["title"]} for r in cur.fetchall()]
