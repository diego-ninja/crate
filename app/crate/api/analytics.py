from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from crate.api.auth import _require_auth
from crate.missing import find_missing_albums
from crate.quality import quality_report
from crate.audio import read_tags, get_audio_files
from crate.api._deps import artist_name_from_id, library_path, extensions, safe_path, get_config
from crate.db import (
    list_tasks, get_latest_scan, get_library_stats, get_library_track_count,
    get_db_ctx, get_setting,
)
from crate.importer import ImportQueue
from crate import navidrome

router = APIRouter()


def _has_library_data() -> bool:
    return get_library_track_count() > 0


@router.get("/api/analytics")
def api_analytics(request: Request):
    _require_auth(request)
    if not _has_library_data():
        return {
            "computing": True,
            "formats": {},
            "decades": {},
            "top_artists": [],
            "bitrates": {},
            "genres": {},
            "sizes_by_format_gb": {},
            "avg_tracks_per_album": 0,
            "total_duration_hours": 0,
        }

    with get_db_ctx() as cur:
        # Genres
        cur.execute(
            "SELECT genre, COUNT(*) as c FROM library_tracks WHERE genre IS NOT NULL AND genre != '' GROUP BY genre ORDER BY c DESC LIMIT 30"
        )
        genres = {r["genre"]: r["c"] for r in cur.fetchall()}

        # Decades (count albums, not tracks)
        cur.execute(
            "SELECT (CAST(year AS INTEGER)/10)*10 || 's' as decade, COUNT(*) as c "
            "FROM library_albums WHERE year IS NOT NULL AND year != '' AND length(year) >= 4 "
            "GROUP BY decade ORDER BY decade"
        )
        decades = {r["decade"]: r["c"] for r in cur.fetchall()}

        # Formats
        cur.execute(
            "SELECT format, COUNT(*) as c FROM library_tracks WHERE format IS NOT NULL GROUP BY format"
        )
        formats = {r["format"]: r["c"] for r in cur.fetchall()}

        # Bitrates (bucketed)
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
        bitrates = {r["bucket"]: r["c"] for r in cur.fetchall()}

        # Top artists by album count
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
        top_artists = [{"id": r["id"], "slug": r["slug"], "name": r["name"], "albums": r["albums"]} for r in cur.fetchall()]

        # Total duration
        cur.execute("SELECT COALESCE(SUM(duration), 0) as total FROM library_tracks")
        dur_row = cur.fetchone()
        total_duration_hours = round(dur_row["total"] / 3600, 1) if dur_row["total"] else 0

        # Sizes by format
        cur.execute(
            "SELECT format, SUM(size) as total FROM library_tracks WHERE format IS NOT NULL GROUP BY format"
        )
        sizes_by_format_gb = {r["format"]: round(r["total"] / (1024**3), 2) for r in cur.fetchall() if r["total"]}

        # Avg tracks per album
        cur.execute("SELECT COUNT(*) AS cnt FROM library_albums")
        album_count = cur.fetchone()["cnt"]
        cur.execute("SELECT COUNT(*) AS cnt FROM library_tracks")
        track_count = cur.fetchone()["cnt"]
        avg_tracks = round(track_count / album_count, 1) if album_count else 0

    return {
        "genres": genres,
        "decades": decades,
        "formats": formats,
        "bitrates": bitrates,
        "top_artists": top_artists,
        "total_duration_hours": total_duration_hours,
        "sizes_by_format_gb": sizes_by_format_gb,
        "avg_tracks_per_album": avg_tracks,
    }


@router.get("/api/activity/recent")
def api_activity_recent(request: Request):
    _require_auth(request)
    tasks = list_tasks(limit=10)
    recent = [
        {
            "id": t["id"],
            "type": t["type"],
            "status": t["status"],
            "created_at": t["created_at"],
            "updated_at": t["updated_at"],
        }
        for t in tasks
    ]

    config = get_config()
    queue = ImportQueue(config)
    pending_imports = len(queue.scan_pending())

    scan = get_latest_scan()
    last_scan = scan["scanned_at"] if scan else None

    return {
        "tasks": recent,
        "pending_imports": pending_imports,
        "last_scan": last_scan,
    }


@router.get("/api/stats")
def api_stats(request: Request):
    _require_auth(request)
    if _has_library_data():
        stats = get_library_stats()
        scan = get_latest_scan()
        config = get_config()
        queue = ImportQueue(config)
        pending_imports = len(queue.scan_pending())
        pending_tasks = len(list_tasks(status="pending"))

        with get_db_ctx() as cur:
            cur.execute("SELECT COALESCE(SUM(duration), 0) / 3600.0 AS val FROM library_tracks")
            total_duration_hours = round(cur.fetchone()["val"], 1)

            cur.execute("SELECT AVG(bitrate) AS val FROM library_tracks WHERE bitrate IS NOT NULL")
            row = cur.fetchone()
            avg_bitrate = round(row["val"]) if row["val"] else 0

            cur.execute(
                "SELECT genre, COUNT(*) AS c FROM library_tracks "
                "WHERE genre IS NOT NULL AND genre != '' "
                "GROUP BY genre ORDER BY c DESC LIMIT 10"
            )
            top_genres = [{"name": r["genre"], "count": r["c"]} for r in cur.fetchall()]

            cur.execute(
                "SELECT a.id, a.slug, a.artist, ar.id AS artist_id, ar.slug AS artist_slug, a.name, a.year, a.dir_mtime FROM library_albums a "
                "LEFT JOIN library_artists ar ON ar.name = a.artist "
                "ORDER BY dir_mtime DESC NULLS LAST LIMIT 10"
            )
            import re as _re
            _year_re = _re.compile(r"^\d{4}\s*[-–]\s*")
            recent_albums = [
                {"id": r["id"], "slug": r["slug"], "artist": r["artist"], "artist_id": r["artist_id"], "artist_slug": r["artist_slug"], "name": r["name"],
                 "display_name": _year_re.sub("", r["name"]),
                 "year": r["year"]}
                for r in cur.fetchall()
            ]

            cur.execute("SELECT COUNT(*) AS c FROM library_tracks WHERE bpm IS NOT NULL")
            analyzed_tracks = cur.fetchone()["c"]

            cur.execute("SELECT AVG(total_duration) AS val FROM library_albums WHERE total_duration IS NOT NULL AND total_duration > 0")
            row2 = cur.fetchone()
            avg_album_duration_min = round(row2["val"] / 60, 1) if row2 and row2["val"] else 0

        return {
            "artists": stats["artists"],
            "albums": stats["albums"],
            "tracks": stats["tracks"],
            "formats": stats["formats"],
            "total_size_gb": round(stats["total_size"] / (1024**3), 2) if stats["total_size"] else 0,
            "last_scan": scan["scanned_at"] if scan else None,
            "pending_imports": pending_imports,
            "pending_tasks": pending_tasks,
            "total_duration_hours": total_duration_hours,
            "avg_bitrate": avg_bitrate,
            "top_genres": top_genres,
            "recent_albums": recent_albums,
            "analyzed_tracks": analyzed_tracks,
            "avg_album_duration_min": avg_album_duration_min,
            "avg_tracks_per_album": round(stats["tracks"] / stats["albums"], 1) if stats["albums"] else 0,
        }

    # Fallback to filesystem
    lib = library_path()
    exts = extensions()
    artists = albums = tracks = total_size = 0
    formats = {}
    for artist_dir in lib.iterdir():
        if not artist_dir.is_dir() or artist_dir.name.startswith("."):
            continue
        artists += 1
        for album_dir in artist_dir.iterdir():
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue
            albums += 1
            for f in album_dir.iterdir():
                if f.is_file() and f.suffix.lower() in exts:
                    tracks += 1
                    ext = f.suffix.lower()
                    formats[ext] = formats.get(ext, 0) + 1
                    total_size += f.stat().st_size

    config = get_config()
    queue = ImportQueue(config)
    pending_imports = len(queue.scan_pending())
    pending_tasks = len(list_tasks(status="pending"))

    scan = get_latest_scan()
    last_scan = scan["scanned_at"] if scan else None

    return {
        "artists": artists, "albums": albums, "tracks": tracks,
        "formats": formats, "total_size_gb": round(total_size / (1024**3), 2),
        "last_scan": last_scan,
        "pending_imports": pending_imports,
        "pending_tasks": pending_tasks,
    }


DEFAULT_MAX_WORKERS = 3


@router.get("/api/activity/live")
def api_activity_live(request: Request):
    _require_auth(request)
    running = list_tasks(status="running")
    running_tasks = []
    for t in running:
        progress = t.get("progress", "")
        running_tasks.append({"id": t["id"], "type": t["type"], "progress": progress})

    recent = list_tasks(limit=10)
    recent_tasks = [
        {"id": t["id"], "type": t["type"], "status": t["status"], "updated_at": t["updated_at"]}
        for t in recent
    ]

    max_workers = int(get_setting("max_workers", str(DEFAULT_MAX_WORKERS)) or DEFAULT_MAX_WORKERS)
    worker_slots = {"max": max_workers, "active": len(running)}

    # System health checks
    pg_ok = True  # if we got here, postgres is up
    try:
        nd_ok = navidrome.ping()
    except Exception:
        nd_ok = False
    watcher_ok = True  # watcher runs in-process with worker

    return {
        "running_tasks": running_tasks,
        "recent_tasks": recent_tasks,
        "worker_slots": worker_slots,
        "systems": {
            "postgres": pg_ok,
            "navidrome": nd_ok,
            "watcher": watcher_ok,
        },
    }


@router.get("/api/timeline")
def api_timeline(request: Request):
    _require_auth(request)
    if _has_library_data():
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
            rows = cur.fetchall()

        years: dict[str, list[dict]] = {}
        for r in rows:
            year = r["year"][:4] if r["year"] else ""
            if year and year.isdigit():
                years.setdefault(year, []).append({
                    "id": r["id"],
                    "slug": r["slug"],
                    "artist": r["artist"],
                    "artist_id": r["artist_id"],
                    "artist_slug": r["artist_slug"],
                    "album": r["name"],
                    "tracks": r["track_count"],
                })
        return {y: albums for y, albums in sorted(years.items())}

    # Fallback to filesystem
    lib = library_path()
    exts = extensions()
    years: dict[str, list[dict]] = {}
    for artist_dir in lib.iterdir():
        if not artist_dir.is_dir() or artist_dir.name.startswith("."):
            continue
        for album_dir in artist_dir.iterdir():
            if not album_dir.is_dir():
                continue
            tracks = get_audio_files(album_dir, exts)
            if not tracks:
                continue
            tags = read_tags(tracks[0])
            year = tags.get("date", "")[:4]
            if year and year.isdigit():
                years.setdefault(year, []).append({
                    "artist": artist_dir.name,
                    "album": album_dir.name,
                    "tracks": len(tracks),
                })

    return {y: albums for y, albums in sorted(years.items())}


@router.get("/api/quality")
def api_quality(request: Request):
    _require_auth(request)
    lib = library_path()
    exts = extensions()
    report = quality_report(lib, exts)
    return report


def api_missing_albums(request: Request, artist: str):
    _require_auth(request)
    lib = library_path()
    artist_dir = safe_path(lib, artist)
    if not artist_dir or not artist_dir.is_dir():
        return JSONResponse({"error": "Artist not found"}, status_code=404)

    exts = extensions()
    result = find_missing_albums(artist_dir, exts)
    return result


@router.get("/api/artists/{artist_id}/missing")
def api_missing_albums_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    return api_missing_albums(request, artist_name)


@router.get("/api/missing-search")
def api_missing_albums_search(request: Request, q: str = Query("")):
    _require_auth(request)
    query = q.strip()
    if not query:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    return api_missing_albums(request, query)


def api_artist_stats(request: Request, name: str):
    """Stats for a single artist: format split, year timeline, audio features."""
    _require_auth(request)
    # Resolve canonical name (case-insensitive)
    from crate.db import get_library_artist
    db_artist = get_library_artist(name)
    canonical = db_artist["name"] if db_artist else name

    with get_db_ctx() as cur:
        # Format distribution
        cur.execute("""
            SELECT t.format, COUNT(*) AS cnt FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE a.artist = %s AND t.format IS NOT NULL
            GROUP BY t.format ORDER BY cnt DESC
        """, (canonical,))
        formats = [{"id": r["format"], "value": r["cnt"]} for r in cur.fetchall()]

        # Albums timeline (year + track count + popularity)
        cur.execute("""
            SELECT name, year, track_count, total_duration, lastfm_listeners, popularity
            FROM library_albums WHERE artist = %s ORDER BY year
        """, (canonical,))
        albums_timeline = [dict(r) for r in cur.fetchall()]

        # Audio features average per album
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
        """, (canonical,))
        audio_by_album = []
        for r in cur.fetchall():
            d = dict(r)
            for k in ("avg_bpm", "avg_energy", "avg_danceability", "avg_valence", "avg_acousticness", "avg_loudness"):
                if d.get(k) is not None:
                    d[k] = round(d[k], 2)
            audio_by_album.append(d)

        # Top tracks by popularity
        cur.execute("""
            SELECT t.title, t.album, t.duration, t.popularity, t.lastfm_listeners, t.bpm, t.energy
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE a.artist = %s AND t.popularity IS NOT NULL
            ORDER BY t.popularity DESC LIMIT 10
        """, (canonical,))
        top_tracks = [dict(r) for r in cur.fetchall()]

        # Genre tags
        cur.execute("""
            SELECT g.name, ag.weight FROM artist_genres ag
            JOIN genres g ON ag.genre_id = g.id
            WHERE ag.artist_name = %s ORDER BY ag.weight DESC
        """, (canonical,))
        genres = [{"name": r["name"], "weight": round(r["weight"], 2)} for r in cur.fetchall()]

    return {
        "formats": formats,
        "albums_timeline": albums_timeline,
        "audio_by_album": audio_by_album,
        "top_tracks_by_popularity": top_tracks,
        "genres": genres,
    }


@router.get("/api/artists/{artist_id}/stats")
def api_artist_stats_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    return api_artist_stats(request, artist_name)


@router.get("/api/insights")
def api_insights(request: Request):
    """Advanced analytics for the Insights page — all data for Nivo charts."""
    _require_auth(request)
    import json

    with get_db_ctx() as cur:
        # Countries (for world map)
        cur.execute("""
            SELECT country, COUNT(*) AS cnt
            FROM library_artists WHERE country IS NOT NULL AND country != ''
            GROUP BY country ORDER BY cnt DESC
        """)
        countries = {r["country"]: r["cnt"] for r in cur.fetchall()}

        # Formation timeline (decade histogram)
        cur.execute("""
            SELECT formed FROM library_artists WHERE formed IS NOT NULL AND formed != ''
        """)
        formation_decades: dict[str, int] = {}
        for r in cur.fetchall():
            year = r["formed"][:4] if len(r["formed"]) >= 4 else r["formed"]
            try:
                decade = f"{int(year) // 10 * 10}s"
                formation_decades[decade] = formation_decades.get(decade, 0) + 1
            except (ValueError, TypeError):
                pass

        # BPM distribution
        cur.execute("""
            SELECT FLOOR(bpm / 10) * 10 AS bucket, COUNT(*) AS cnt
            FROM library_tracks WHERE bpm IS NOT NULL
            GROUP BY bucket ORDER BY bucket
        """)
        bpm_dist = [{"bpm": f"{int(r['bucket'])}-{int(r['bucket'])+9}", "count": r["cnt"]} for r in cur.fetchall()]

        # Key distribution (circle of fifths)
        cur.execute("""
            SELECT audio_key, audio_scale, COUNT(*) AS cnt
            FROM library_tracks WHERE audio_key IS NOT NULL AND audio_key != ''
            GROUP BY audio_key, audio_scale ORDER BY cnt DESC
        """)
        keys = [{"key": f"{r['audio_key']} {r['audio_scale'] or ''}".strip(), "count": r["cnt"]} for r in cur.fetchall()]

        # Energy vs Danceability scatter
        cur.execute("""
            SELECT energy, danceability, artist, title
            FROM library_tracks
            WHERE energy IS NOT NULL AND danceability IS NOT NULL
            LIMIT 500
        """)
        energy_dance = [{"x": round(r["energy"], 2), "y": round(r["danceability"], 2),
                         "artist": r["artist"], "title": r["title"]} for r in cur.fetchall()]

        # Format distribution
        cur.execute("""
            SELECT format, COUNT(*) AS cnt FROM library_tracks
            WHERE format IS NOT NULL GROUP BY format ORDER BY cnt DESC
        """)
        formats = [{"id": r["format"], "value": r["cnt"]} for r in cur.fetchall()]

        # Bitrate distribution
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
        bitrates = [{"id": r["bracket"], "value": r["cnt"]} for r in cur.fetchall()]

        # Top genres (from genre system)
        cur.execute("""
            SELECT g.name, COUNT(DISTINCT ag.artist_name) AS artists, COUNT(DISTINCT alg.album_id) AS albums
            FROM genres g
            LEFT JOIN artist_genres ag ON g.id = ag.genre_id
            LEFT JOIN album_genres alg ON g.id = alg.genre_id
            GROUP BY g.id, g.name
            HAVING COUNT(DISTINCT ag.artist_name) > 0
            ORDER BY COUNT(DISTINCT ag.artist_name) DESC LIMIT 20
        """)
        top_genres = [{"genre": r["name"], "artists": r["artists"], "albums": r["albums"]} for r in cur.fetchall()]

        # Similar artists network
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

        # Artist popularity ranking (Spotify or Last.fm listeners)
        cur.execute("""
            SELECT name, spotify_popularity, listeners
            FROM library_artists
            WHERE (spotify_popularity IS NOT NULL AND spotify_popularity > 0)
               OR (listeners IS NOT NULL AND listeners > 0)
            ORDER BY COALESCE(spotify_popularity, 0) DESC, COALESCE(listeners, 0) DESC
            LIMIT 20
        """)
        popularity = [{"artist": r["name"],
                        "popularity": r["spotify_popularity"] or (min(100, (r["listeners"] or 0) // 10000)),
                        "listeners": r["listeners"] or 0} for r in cur.fetchall()]

        # Albums per decade
        cur.execute("""
            SELECT year, COUNT(*) AS cnt FROM library_albums
            WHERE year IS NOT NULL AND year != '' GROUP BY year ORDER BY year
        """)
        albums_by_year: dict[str, int] = {}
        for r in cur.fetchall():
            y = r["year"][:4] if r["year"] and len(r["year"]) >= 4 else r["year"]
            try:
                decade = f"{int(y) // 10 * 10}s"
                albums_by_year[decade] = albums_by_year.get(decade, 0) + r["cnt"]
            except (ValueError, TypeError):
                pass

        # Library completeness
        cur.execute("SELECT COUNT(*) AS total, SUM(CASE WHEN has_photo = 1 THEN 1 ELSE 0 END) AS with_photo, SUM(CASE WHEN enriched_at IS NOT NULL THEN 1 ELSE 0 END) AS enriched FROM library_artists")
        completeness_row = cur.fetchone()
        cur.execute("SELECT COUNT(*) AS total, SUM(CASE WHEN has_cover = 1 THEN 1 ELSE 0 END) AS with_cover FROM library_albums")
        cover_row = cur.fetchone()
        cur.execute("SELECT COUNT(*) AS total, SUM(CASE WHEN bpm IS NOT NULL THEN 1 ELSE 0 END) AS analyzed FROM library_tracks")
        analysis_row = cur.fetchone()

        completeness = {
            "artists_total": completeness_row["total"],
            "artists_with_photo": completeness_row["with_photo"],
            "artists_enriched": completeness_row["enriched"],
            "albums_total": cover_row["total"],
            "albums_with_cover": cover_row["with_cover"],
            "tracks_total": analysis_row["total"],
            "tracks_analyzed": analysis_row["analyzed"],
        }

        # Mood distribution (aggregate mood tags across all tracks)
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
        # Normalize and take top 12
        top_moods = sorted(mood_counts.items(), key=lambda x: x[1], reverse=True)[:12]
        moods = [{"mood": m, "score": round(s, 1)} for m, s in top_moods]

        # Loudness distribution
        cur.execute("""
            SELECT FLOOR(loudness / 3) * 3 AS bucket, COUNT(*) AS cnt
            FROM library_tracks WHERE loudness IS NOT NULL
            GROUP BY bucket ORDER BY bucket
        """)
        loudness_dist = [{"db": f"{int(r['bucket'])} dB", "count": r["cnt"]} for r in cur.fetchall()]

        # Top albums by Last.fm listeners
        cur.execute("""
            SELECT name, artist, lastfm_listeners, popularity, year
            FROM library_albums
            WHERE lastfm_listeners IS NOT NULL AND lastfm_listeners > 0
            ORDER BY lastfm_listeners DESC LIMIT 20
        """)
        import re as _re
        def _strip_year_prefix(name: str) -> str:
            return _re.sub(r"^\d{4}\s*[-–]\s*", "", name)
        top_albums = [{"album": _strip_year_prefix(r["name"]), "artist": r["artist"],
                       "listeners": r["lastfm_listeners"] or 0,
                       "popularity": r["popularity"] or 0, "year": r["year"]} for r in cur.fetchall()]

        # Acousticness vs Instrumentalness scatter
        cur.execute("""
            SELECT acousticness, instrumentalness, artist, title
            FROM library_tracks
            WHERE acousticness IS NOT NULL AND instrumentalness IS NOT NULL
            LIMIT 500
        """)
        acoustic_instrumental = [{"x": round(r["acousticness"], 2), "y": round(r["instrumentalness"], 2),
                                  "artist": r["artist"], "title": r["title"]} for r in cur.fetchall()]

    return {
        "countries": countries,
        "formation_decades": formation_decades,
        "bpm_distribution": bpm_dist,
        "keys": keys,
        "energy_danceability": energy_dance,
        "formats": formats,
        "bitrates": bitrates,
        "top_genres": top_genres,
        "network": {"nodes": network_nodes, "links": network_links},
        "popularity": popularity,
        "albums_by_decade": albums_by_year,
        "completeness": completeness,
        "moods": moods,
        "loudness_distribution": loudness_dist,
        "top_albums": top_albums,
        "acoustic_instrumental": acoustic_instrumental,
    }
