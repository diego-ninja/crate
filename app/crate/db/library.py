import json
import uuid
from datetime import datetime, timezone
from psycopg2 import sql

from crate.db.core import get_db_ctx
from crate.slugs import build_album_slug, build_artist_slug, build_track_slug

# ── Library helpers ──────────────────────────────────────────────

def get_library_artists(q: str | None = None, sort: str = "name",
                        page: int = 1, per_page: int = 60) -> tuple[list[dict], int]:
    query = "SELECT * FROM library_artists WHERE 1=1"
    count_query = "SELECT COUNT(*) AS cnt FROM library_artists WHERE 1=1"
    params: list = []
    count_params: list = []

    if q:
        query += " AND name ILIKE %s"
        count_query += " AND name ILIKE %s"
        like = f"%{q}%"
        params.append(like)
        count_params.append(like)

    sort_map = {
        "name": "name ASC",
        "albums": "album_count DESC",
        "tracks": "track_count DESC",
        "size": "total_size DESC",
        "updated": "updated_at DESC",
    }
    query += f" ORDER BY {sort_map.get(sort, 'name ASC')}"
    query += " LIMIT %s OFFSET %s"
    params.extend([per_page, (page - 1) * per_page])

    with get_db_ctx() as cur:
        cur.execute(count_query, count_params)
        total = cur.fetchone()["cnt"]
        cur.execute(query, params)
        rows = cur.fetchall()
    return [_row_to_lib_artist(r) for r in rows], total


def get_library_artist(name: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM library_artists WHERE LOWER(name) = LOWER(%s) OR folder_name = %s",
            (name, name),
        )
        row = cur.fetchone()
    return _row_to_lib_artist(row) if row else None


def get_library_artist_by_id(artist_id: int) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM library_artists WHERE id = %s", (artist_id,))
        row = cur.fetchone()
    return _row_to_lib_artist(row) if row else None


def get_library_albums(artist: str) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM library_albums WHERE LOWER(artist) = LOWER(%s) ORDER BY year, name", (artist,)
        )
        rows = cur.fetchall()
    return [_row_to_lib_album(r) for r in rows]


def get_library_album(artist: str, album: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM library_albums WHERE LOWER(artist) = LOWER(%s) AND LOWER(name) = LOWER(%s)", (artist, album)
        )
        row = cur.fetchone()
    return _row_to_lib_album(row) if row else None


def get_library_album_by_id(album_id: int) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM library_albums WHERE id = %s", (album_id,))
        row = cur.fetchone()
    return _row_to_lib_album(row) if row else None


def get_library_track_by_id(track_id: int) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM library_tracks WHERE id = %s", (track_id,))
        row = cur.fetchone()
    return _row_to_lib_track(row) if row else None


def get_library_track_by_storage_id(storage_id: str) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM library_tracks WHERE storage_id = %s", (storage_id,))
        row = cur.fetchone()
    return _row_to_lib_track(row) if row else None


def get_library_tracks(album_id: int) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM library_tracks WHERE album_id = %s ORDER BY disc_number, track_number",
            (album_id,),
        )
        rows = cur.fetchall()
    results = []
    for r in rows:
        d = dict(r)
        mood = d.get("mood_json")
        if mood is not None and isinstance(mood, str):
            d["mood_json"] = json.loads(mood)
        results.append(d)
    return results


def _allocate_unique_slug(cur, table: str, base_slug: str) -> str:
    candidate = base_slug or "item"
    suffix = 2
    while True:
        cur.execute(
            sql.SQL("SELECT 1 FROM {} WHERE slug = %s LIMIT 1").format(sql.Identifier(table)),
            (candidate,),
        )
        if not cur.fetchone():
            return candidate
        candidate = f"{base_slug}-{suffix}"
        suffix += 1


def _new_storage_id() -> str:
    return str(uuid.uuid4())


def get_library_stats() -> dict:
    with get_db_ctx() as cur:
        cur.execute("SELECT COUNT(*) AS cnt FROM library_artists")
        artists = cur.fetchone()["cnt"]
        cur.execute("SELECT COUNT(*) AS cnt FROM library_albums")
        albums = cur.fetchone()["cnt"]
        cur.execute("SELECT COUNT(*) AS cnt FROM library_tracks")
        tracks = cur.fetchone()["cnt"]
        cur.execute("SELECT COALESCE(SUM(total_size), 0) AS total FROM library_artists")
        size = cur.fetchone()["total"]
        cur.execute(
            "SELECT format, COUNT(*) as cnt FROM library_tracks WHERE format IS NOT NULL GROUP BY format ORDER BY cnt DESC"
        )
        fmt_rows = cur.fetchall()
    formats = {r["format"]: r["cnt"] for r in fmt_rows}
    return {
        "artists": artists,
        "albums": albums,
        "tracks": tracks,
        "total_size": size,
        "formats": formats,
    }


def get_library_track_count() -> int:
    with get_db_ctx() as cur:
        cur.execute("SELECT COUNT(*) AS cnt FROM library_tracks")
        return cur.fetchone()["cnt"]


def upsert_artist(data: dict):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute("SELECT slug, storage_id FROM library_artists WHERE name = %s", (data["name"],))
        existing = cur.fetchone()
        slug = existing["slug"] if existing and existing.get("slug") else _allocate_unique_slug(
            cur, "library_artists", build_artist_slug(data["name"])
        )
        storage_id = (
            str(existing["storage_id"])
            if existing and existing.get("storage_id")
            else data.get("storage_id") or _new_storage_id()
        )
        cur.execute("""
            INSERT INTO library_artists (name, storage_id, slug, folder_name, album_count, track_count, total_size,
                formats_json, primary_format, has_photo, dir_mtime, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT(name) DO UPDATE SET
                storage_id=COALESCE(library_artists.storage_id, EXCLUDED.storage_id),
                slug=COALESCE(library_artists.slug, EXCLUDED.slug),
                folder_name=COALESCE(library_artists.folder_name, EXCLUDED.folder_name),
                album_count=EXCLUDED.album_count, track_count=EXCLUDED.track_count,
                total_size=EXCLUDED.total_size, formats_json=EXCLUDED.formats_json,
                primary_format=EXCLUDED.primary_format, has_photo=EXCLUDED.has_photo,
                dir_mtime=EXCLUDED.dir_mtime, updated_at=EXCLUDED.updated_at
        """, (
            data["name"], storage_id, slug, data.get("folder_name") or data["name"],
            data.get("album_count", 0), data.get("track_count", 0),
            data.get("total_size", 0), json.dumps(data.get("formats", [])),
            data.get("primary_format"), data.get("has_photo", 0),
            data.get("dir_mtime"), now,
        ))


def upsert_album(data: dict) -> int:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute("SELECT slug, storage_id FROM library_albums WHERE path = %s", (data["path"],))
        existing = cur.fetchone()
        slug = existing["slug"] if existing and existing.get("slug") else _allocate_unique_slug(
            cur, "library_albums", build_album_slug(data["artist"], data["name"])
        )
        storage_id = (
            str(existing["storage_id"])
            if existing and existing.get("storage_id")
            else data.get("storage_id") or _new_storage_id()
        )
        cur.execute("""
            INSERT INTO library_albums (storage_id, artist, name, slug, path, track_count, total_size,
                total_duration, formats_json, year, genre, has_cover,
                musicbrainz_albumid, tag_album, dir_mtime, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT(path) DO UPDATE SET
                storage_id=COALESCE(library_albums.storage_id, EXCLUDED.storage_id),
                artist=EXCLUDED.artist, name=EXCLUDED.name, slug=COALESCE(library_albums.slug, EXCLUDED.slug),
                track_count=EXCLUDED.track_count, total_size=EXCLUDED.total_size,
                total_duration=EXCLUDED.total_duration, formats_json=EXCLUDED.formats_json,
                year=EXCLUDED.year, genre=EXCLUDED.genre, has_cover=EXCLUDED.has_cover,
                musicbrainz_albumid=COALESCE(NULLIF(EXCLUDED.musicbrainz_albumid, ''), library_albums.musicbrainz_albumid),
                tag_album=COALESCE(EXCLUDED.tag_album, library_albums.tag_album),
                dir_mtime=EXCLUDED.dir_mtime, updated_at=EXCLUDED.updated_at
        """, (
            storage_id, data["artist"], data["name"], slug, data["path"],
            data.get("track_count", 0), data.get("total_size", 0),
            data.get("total_duration", 0), json.dumps(data.get("formats", [])),
            data.get("year"), data.get("genre"), data.get("has_cover", 0),
            data.get("musicbrainz_albumid"), data.get("tag_album"),
            data.get("dir_mtime"), now,
        ))
        cur.execute("SELECT id FROM library_albums WHERE path = %s", (data["path"],))
        row = cur.fetchone()
    return row["id"]


def upsert_track(data: dict):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute("SELECT slug, storage_id FROM library_tracks WHERE path = %s", (data["path"],))
        existing = cur.fetchone()
        slug = existing["slug"] if existing and existing.get("slug") else _allocate_unique_slug(
            cur,
            "library_tracks",
            build_track_slug(data["artist"], data.get("title"), data.get("filename")),
        )
        storage_id = (
            str(existing["storage_id"])
            if existing and existing.get("storage_id")
            else data.get("storage_id") or _new_storage_id()
        )
        cur.execute("""
            INSERT INTO library_tracks (storage_id, album_id, artist, album, slug, filename, title,
                track_number, disc_number, format, bitrate, sample_rate, bit_depth,
                duration, size,
                year, genre, albumartist, musicbrainz_albumid, musicbrainz_trackid,
                path, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT(path) DO UPDATE SET
                storage_id=COALESCE(library_tracks.storage_id, EXCLUDED.storage_id),
                album_id=EXCLUDED.album_id, artist=EXCLUDED.artist, album=EXCLUDED.album,
                slug=COALESCE(library_tracks.slug, EXCLUDED.slug),
                filename=EXCLUDED.filename, title=EXCLUDED.title,
                track_number=EXCLUDED.track_number, disc_number=EXCLUDED.disc_number,
                format=EXCLUDED.format, bitrate=EXCLUDED.bitrate,
                sample_rate=EXCLUDED.sample_rate, bit_depth=EXCLUDED.bit_depth,
                duration=EXCLUDED.duration, size=EXCLUDED.size,
                year=EXCLUDED.year, genre=EXCLUDED.genre, albumartist=EXCLUDED.albumartist,
                musicbrainz_albumid=COALESCE(NULLIF(EXCLUDED.musicbrainz_albumid, ''), library_tracks.musicbrainz_albumid),
                musicbrainz_trackid=COALESCE(NULLIF(EXCLUDED.musicbrainz_trackid, ''), library_tracks.musicbrainz_trackid),
                updated_at=EXCLUDED.updated_at
        """, (
            storage_id, data.get("album_id"), data["artist"], data["album"], slug,
            data["filename"], data.get("title"), data.get("track_number"),
            data.get("disc_number", 1), data.get("format"), data.get("bitrate"),
            data.get("sample_rate"), data.get("bit_depth"),
            data.get("duration"), data.get("size"), data.get("year"),
            data.get("genre"), data.get("albumartist"),
            data.get("musicbrainz_albumid"), data.get("musicbrainz_trackid"),
            data["path"], now,
        ))


def update_track_analysis(path: str, bpm: float | None, key: str | None,
                          scale: str | None, energy: float | None, mood: dict | None,
                          danceability: float | None = None, valence: float | None = None,
                          acousticness: float | None = None, instrumentalness: float | None = None,
                          loudness: float | None = None, dynamic_range: float | None = None,
                          spectral_complexity: float | None = None):
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_tracks SET bpm=%s, audio_key=%s, audio_scale=%s, energy=%s, mood_json=%s, "
            "danceability=%s, valence=%s, acousticness=%s, instrumentalness=%s, "
            "loudness=%s, dynamic_range=%s, spectral_complexity=%s "
            "WHERE path=%s",
            (bpm, key, scale, energy, json.dumps(mood) if mood else None,
             danceability, valence, acousticness, instrumentalness,
             loudness, dynamic_range, spectral_complexity, path),
        )


def update_artist_enrichment(name: str, data: dict):
    """Update artist enrichment data. Only updates fields that have non-None values
    to avoid overwriting existing data when a source fails."""
    now = datetime.now(timezone.utc).isoformat()

    # Build SET clause dynamically — only include fields with actual values
    field_map = {
        "bio": data.get("bio"),
        "tags_json": json.dumps(data["tags"]) if "tags" in data else None,
        "similar_json": json.dumps(data["similar"]) if "similar" in data else None,
        "spotify_id": data.get("spotify_id"),
        "spotify_popularity": data.get("spotify_popularity"),
        "spotify_followers": data.get("spotify_followers"),
        "mbid": data.get("mbid"),
        "country": data.get("country"),
        "area": data.get("area"),
        "formed": data.get("formed"),
        "ended": data.get("ended"),
        "artist_type": data.get("artist_type"),
        "members_json": json.dumps(data["members"]) if "members" in data else None,
        "urls_json": json.dumps(data["urls"]) if "urls" in data else None,
        "listeners": data.get("listeners"),
        "lastfm_playcount": data.get("lastfm_playcount"),
        "discogs_id": data.get("discogs_id"),
        "discogs_profile": data.get("discogs_profile"),
        "discogs_members_json": json.dumps(data["discogs_members"]) if "discogs_members" in data else None,
    }

    # Filter out None values — keep existing DB data intact
    updates = {k: v for k, v in field_map.items() if v is not None}
    updates["enriched_at"] = now  # always update timestamp

    if not updates:
        return

    set_clause = ", ".join(f"{k} = %s" for k in updates)
    values = list(updates.values()) + [name]

    with get_db_ctx() as cur:
        cur.execute(f"UPDATE library_artists SET {set_clause} WHERE name = %s", values)


def delete_artist(name: str):
    with get_db_ctx() as cur:
        cur.execute("SELECT id FROM library_albums WHERE artist = %s", (name,))
        album_ids = [r["id"] for r in cur.fetchall()]
        for aid in album_ids:
            cur.execute("DELETE FROM library_tracks WHERE album_id = %s", (aid,))
        cur.execute("DELETE FROM library_albums WHERE artist = %s", (name,))
        cur.execute("DELETE FROM library_artists WHERE name = %s", (name,))


def delete_album(path: str):
    with get_db_ctx() as cur:
        cur.execute("SELECT id FROM library_albums WHERE path = %s", (path,))
        row = cur.fetchone()
        if row:
            cur.execute("DELETE FROM library_tracks WHERE album_id = %s", (row["id"],))
            cur.execute("DELETE FROM library_albums WHERE path = %s", (path,))


def delete_track(path: str):
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM library_tracks WHERE path = %s", (path,))


# ── Library helpers ──────────────────────────────────────────────

def set_track_rating(track_id: int, rating: int) -> None:
    """Set rating (0-5) for a track."""
    with get_db_ctx() as cur:
        cur.execute("UPDATE library_tracks SET rating = %s WHERE id = %s", (max(0, min(5, rating)), track_id))


def get_track_rating(track_id: int) -> int:
    with get_db_ctx() as cur:
        cur.execute("SELECT rating FROM library_tracks WHERE id = %s", (track_id,))
        row = cur.fetchone()
        return row["rating"] if row and row["rating"] else 0


def _row_to_lib_artist(row: dict) -> dict:
    d = dict(row)
    if d.get("storage_id") is not None:
        d["storage_id"] = str(d["storage_id"])
    fmt = d.pop("formats_json", [])
    d["formats"] = fmt if isinstance(fmt, list) else json.loads(fmt or "[]")
    return d


def _row_to_lib_album(row: dict) -> dict:
    d = dict(row)
    if d.get("storage_id") is not None:
        d["storage_id"] = str(d["storage_id"])
    fmt = d.pop("formats_json", [])
    d["formats"] = fmt if isinstance(fmt, list) else json.loads(fmt or "[]")
    return d


def _row_to_lib_track(row: dict | None) -> dict | None:
    if not row:
        return None
    d = dict(row)
    if d.get("storage_id") is not None:
        d["storage_id"] = str(d["storage_id"])
    mood = d.get("mood_json")
    if mood is not None and isinstance(mood, str):
        d["mood_json"] = json.loads(mood)
    return d
