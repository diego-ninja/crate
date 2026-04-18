import json
import uuid
from datetime import datetime, timezone

from crate.db.tx import read_scope, transaction_scope
from crate.slugs import build_album_slug, build_artist_slug, build_track_slug
from sqlalchemy import text

# ── Library helpers ──────────────────────────────────────────────

def get_library_artists(q: str | None = None, sort: str = "name",
                        page: int = 1, per_page: int = 60) -> tuple[list[dict], int]:
    query = "SELECT * FROM library_artists WHERE 1=1"
    count_query = "SELECT COUNT(*) AS cnt FROM library_artists WHERE 1=1"
    params: dict = {}
    count_params: dict = {}

    if q:
        query += " AND name ILIKE :q"
        count_query += " AND name ILIKE :q"
        like = f"%{q}%"
        params["q"] = like
        count_params["q"] = like

    sort_map = {
        "name": "name ASC",
        "albums": "album_count DESC",
        "tracks": "track_count DESC",
        "size": "total_size DESC",
        "updated": "updated_at DESC",
    }
    query += f" ORDER BY {sort_map.get(sort, 'name ASC')}"
    query += " LIMIT :lim OFFSET :off"
    params["lim"] = per_page
    params["off"] = (page - 1) * per_page

    with transaction_scope() as session:
        total = session.execute(text(count_query), count_params).mappings().first()["cnt"]
        rows = session.execute(text(query), params).mappings().all()
    return [_row_to_lib_artist(r) for r in rows], total


def get_library_artist(name: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT * FROM library_artists WHERE LOWER(name) = LOWER(:name) OR folder_name = :folder_name"),
            {"name": name, "folder_name": name},
        ).mappings().first()
    return _row_to_lib_artist(row) if row else None


def get_library_artist_by_id(artist_id: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT * FROM library_artists WHERE id = :artist_id"), {"artist_id": artist_id}).mappings().first()
    return _row_to_lib_artist(row) if row else None


def get_library_albums(artist: str) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT * FROM library_albums WHERE LOWER(artist) = LOWER(:artist) ORDER BY year, name"),
            {"artist": artist},
        ).mappings().all()
    return [_row_to_lib_album(r) for r in rows]


def get_library_album(artist: str, album: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT * FROM library_albums WHERE LOWER(artist) = LOWER(:artist) AND LOWER(name) = LOWER(:album)"),
            {"artist": artist, "album": album},
        ).mappings().first()
    return _row_to_lib_album(row) if row else None


def get_library_album_by_id(album_id: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT * FROM library_albums WHERE id = :album_id"), {"album_id": album_id}).mappings().first()
    return _row_to_lib_album(row) if row else None


def get_library_track_by_id(track_id: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT * FROM library_tracks WHERE id = :track_id"), {"track_id": track_id}).mappings().first()
    return _row_to_lib_track(row) if row else None


def get_library_track_by_storage_id(storage_id: str) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT * FROM library_tracks WHERE storage_id = :storage_id"), {"storage_id": storage_id}).mappings().first()
    return _row_to_lib_track(row) if row else None


def get_library_track_by_path(path: str) -> dict | None:
    with read_scope() as session:
        row = session.execute(text("SELECT * FROM library_tracks WHERE path = :path"), {"path": path}).mappings().first()
    return _row_to_lib_track(row) if row else None


def get_library_tracks_by_storage_ids(storage_ids: list[str]) -> dict[str, dict]:
    cleaned_storage_ids = [storage_id for storage_id in storage_ids if storage_id]
    if not cleaned_storage_ids:
        return {}
    with read_scope() as session:
        rows = session.execute(
            text("SELECT * FROM library_tracks WHERE storage_id = ANY(:storage_ids)"),
            {"storage_ids": cleaned_storage_ids},
        ).mappings().all()
    return {
        row["storage_id"]: _row_to_lib_track(row)
        for row in rows
        if row and row.get("storage_id") is not None
    }


def get_library_tracks(album_id: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT * FROM library_tracks WHERE album_id = :album_id ORDER BY disc_number, track_number"),
        {"album_id": album_id},
        ).mappings().all()
    return [_row_to_lib_track(r) for r in rows if r]


def _allocate_unique_slug(session, table: str, base_slug: str) -> str:
    candidate = base_slug or "item"
    suffix = 2
    # table name is from our own code, not user input — safe to interpolate
    while True:
        row = session.execute(
            text(f"SELECT 1 FROM {table} WHERE slug = :slug LIMIT 1"),
            {"slug": candidate},
        ).mappings().first()
        if not row:
            return candidate
        candidate = f"{base_slug}-{suffix}"
        suffix += 1


def _new_storage_id() -> str:
    return str(uuid.uuid4())


def get_library_stats() -> dict:
    with transaction_scope() as session:
        artists = session.execute(text("SELECT COUNT(*) AS cnt FROM library_artists")).mappings().first()["cnt"]
        albums = session.execute(text("SELECT COUNT(*) AS cnt FROM library_albums")).mappings().first()["cnt"]
        tracks = session.execute(text("SELECT COUNT(*) AS cnt FROM library_tracks")).mappings().first()["cnt"]
        size = session.execute(text("SELECT COALESCE(SUM(total_size), 0) AS total FROM library_artists")).mappings().first()["total"]
        fmt_rows = session.execute(
            text("SELECT format, COUNT(*) as cnt FROM library_tracks WHERE format IS NOT NULL GROUP BY format ORDER BY cnt DESC")
        ).mappings().all()
    formats = {r["format"]: r["cnt"] for r in fmt_rows}
    return {
        "artists": artists,
        "albums": albums,
        "tracks": tracks,
        "total_size": size,
        "formats": formats,
    }


def get_library_track_count() -> int:
    with transaction_scope() as session:
        return session.execute(text("SELECT COUNT(*) AS cnt FROM library_tracks")).mappings().first()["cnt"]


def upsert_artist(data: dict, *, session=None):
    if session is None:
        with transaction_scope() as s:
            return upsert_artist(data, session=s)
    now = datetime.now(timezone.utc).isoformat()
    existing = session.execute(
        text("SELECT slug, storage_id::text FROM library_artists WHERE name = :name"),
        {"name": data["name"]},
    ).mappings().first()
    slug = existing["slug"] if existing and existing.get("slug") else _allocate_unique_slug(
        session, "library_artists", build_artist_slug(data["name"])
    )
    storage_id = (
        str(existing["storage_id"])
        if existing and existing.get("storage_id")
        else data.get("storage_id") or _new_storage_id()
    )
    session.execute(text("""
        INSERT INTO library_artists (name, storage_id, slug, folder_name, album_count, track_count, total_size,
            formats_json, primary_format, has_photo, dir_mtime, updated_at)
        VALUES (:name, :storage_id, :slug, :folder_name, :album_count, :track_count, :total_size,
                :formats_json, :primary_format, :has_photo, :dir_mtime, :updated_at)
        ON CONFLICT(name) DO UPDATE SET
            storage_id=COALESCE(library_artists.storage_id, EXCLUDED.storage_id),
            slug=COALESCE(library_artists.slug, EXCLUDED.slug),
            folder_name=COALESCE(library_artists.folder_name, EXCLUDED.folder_name),
            album_count=EXCLUDED.album_count, track_count=EXCLUDED.track_count,
            total_size=EXCLUDED.total_size, formats_json=EXCLUDED.formats_json,
            primary_format=EXCLUDED.primary_format, has_photo=EXCLUDED.has_photo,
            dir_mtime=EXCLUDED.dir_mtime, updated_at=EXCLUDED.updated_at
    """), {
        "name": data["name"], "storage_id": storage_id, "slug": slug,
        "folder_name": data.get("folder_name") or data["name"],
        "album_count": data.get("album_count", 0), "track_count": data.get("track_count", 0),
        "total_size": data.get("total_size", 0), "formats_json": json.dumps(data.get("formats", [])),
        "primary_format": data.get("primary_format"), "has_photo": data.get("has_photo", 0),
        "dir_mtime": data.get("dir_mtime"), "updated_at": now,
    })


def upsert_album(data: dict, *, session=None) -> int:
    if session is None:
        with transaction_scope() as s:
            return upsert_album(data, session=s)
    now = datetime.now(timezone.utc).isoformat()
    existing = session.execute(
        text("SELECT slug, storage_id::text FROM library_albums WHERE path = :path"),
        {"path": data["path"]},
    ).mappings().first()
    slug = existing["slug"] if existing and existing.get("slug") else _allocate_unique_slug(
        session, "library_albums", build_album_slug(data["artist"], data["name"])
    )
    storage_id = (
        str(existing["storage_id"])
        if existing and existing.get("storage_id")
        else data.get("storage_id") or _new_storage_id()
    )
    session.execute(text("""
        INSERT INTO library_albums (storage_id, artist, name, slug, path, track_count, total_size,
            total_duration, formats_json, year, genre, has_cover,
            musicbrainz_albumid, tag_album, dir_mtime, updated_at)
        VALUES (:storage_id, :artist, :name, :slug, :path, :track_count, :total_size,
                :total_duration, :formats_json, :year, :genre, :has_cover,
                :musicbrainz_albumid, :tag_album, :dir_mtime, :updated_at)
        ON CONFLICT(path) DO UPDATE SET
            storage_id=COALESCE(library_albums.storage_id, EXCLUDED.storage_id),
            artist=EXCLUDED.artist, name=EXCLUDED.name, slug=COALESCE(library_albums.slug, EXCLUDED.slug),
            track_count=EXCLUDED.track_count, total_size=EXCLUDED.total_size,
            total_duration=EXCLUDED.total_duration, formats_json=EXCLUDED.formats_json,
            year=EXCLUDED.year, genre=EXCLUDED.genre, has_cover=EXCLUDED.has_cover,
            musicbrainz_albumid=COALESCE(NULLIF(EXCLUDED.musicbrainz_albumid, ''), library_albums.musicbrainz_albumid),
            tag_album=COALESCE(EXCLUDED.tag_album, library_albums.tag_album),
            dir_mtime=EXCLUDED.dir_mtime, updated_at=EXCLUDED.updated_at
    """), {
        "storage_id": storage_id, "artist": data["artist"], "name": data["name"],
        "slug": slug, "path": data["path"],
        "track_count": data.get("track_count", 0), "total_size": data.get("total_size", 0),
        "total_duration": data.get("total_duration", 0), "formats_json": json.dumps(data.get("formats", [])),
        "year": data.get("year"), "genre": data.get("genre"), "has_cover": data.get("has_cover", 0),
        "musicbrainz_albumid": data.get("musicbrainz_albumid"), "tag_album": data.get("tag_album"),
        "dir_mtime": data.get("dir_mtime"), "updated_at": now,
    })
    row = session.execute(text("SELECT id FROM library_albums WHERE path = :path"), {"path": data["path"]}).mappings().first()
    return row["id"]


def upsert_track(data: dict, *, session=None):
    if session is None:
        with transaction_scope() as s:
            return upsert_track(data, session=s)
    now = datetime.now(timezone.utc).isoformat()
    existing = session.execute(
        text("SELECT slug, storage_id::text FROM library_tracks WHERE path = :path"),
        {"path": data["path"]},
    ).mappings().first()
    slug = existing["slug"] if existing and existing.get("slug") else _allocate_unique_slug(
        session,
        "library_tracks",
        build_track_slug(data["artist"], data.get("title"), data.get("filename")),
    )
    storage_id = (
        str(existing["storage_id"])
        if existing and existing.get("storage_id")
        else data.get("storage_id") or _new_storage_id()
    )
    session.execute(text("""
        INSERT INTO library_tracks (storage_id, album_id, artist, album, slug, filename, title,
            track_number, disc_number, format, bitrate, sample_rate, bit_depth,
            duration, size,
            year, genre, albumartist, musicbrainz_albumid, musicbrainz_trackid,
            path, updated_at)
        VALUES (:storage_id, :album_id, :artist, :album, :slug, :filename, :title,
                :track_number, :disc_number, :format, :bitrate, :sample_rate, :bit_depth,
                :duration, :size,
                :year, :genre, :albumartist, :musicbrainz_albumid, :musicbrainz_trackid,
                :path, :updated_at)
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
    """), {
        "storage_id": storage_id, "album_id": data.get("album_id"),
        "artist": data["artist"], "album": data["album"], "slug": slug,
        "filename": data["filename"], "title": data.get("title"),
        "track_number": data.get("track_number"),
        "disc_number": data.get("disc_number", 1), "format": data.get("format"),
        "bitrate": data.get("bitrate"),
        "sample_rate": data.get("sample_rate"), "bit_depth": data.get("bit_depth"),
        "duration": data.get("duration"), "size": data.get("size"),
        "year": data.get("year"),
        "genre": data.get("genre"), "albumartist": data.get("albumartist"),
        "musicbrainz_albumid": data.get("musicbrainz_albumid"),
        "musicbrainz_trackid": data.get("musicbrainz_trackid"),
        "path": data["path"], "updated_at": now,
    })


def update_track_analysis(path: str, bpm: float | None, key: str | None,
                          scale: str | None, energy: float | None, mood: dict | None,
                          danceability: float | None = None, valence: float | None = None,
                          acousticness: float | None = None, instrumentalness: float | None = None,
                          loudness: float | None = None, dynamic_range: float | None = None,
                          spectral_complexity: float | None = None, *, session=None):
    if session is None:
        with transaction_scope() as s:
            return update_track_analysis(path, bpm, key, scale, energy, mood,
                                         danceability, valence, acousticness, instrumentalness,
                                         loudness, dynamic_range, spectral_complexity, session=s)
    session.execute(
        text("UPDATE library_tracks SET bpm=:bpm, audio_key=:key, audio_scale=:scale, energy=:energy, mood_json=:mood, "
             "danceability=:danceability, valence=:valence, acousticness=:acousticness, instrumentalness=:instrumentalness, "
             "loudness=:loudness, dynamic_range=:dynamic_range, spectral_complexity=:spectral_complexity "
             "WHERE path=:path"),
        {"bpm": bpm, "key": key, "scale": scale, "energy": energy,
         "mood": json.dumps(mood) if mood else None,
         "danceability": danceability, "valence": valence, "acousticness": acousticness,
         "instrumentalness": instrumentalness,
         "loudness": loudness, "dynamic_range": dynamic_range,
         "spectral_complexity": spectral_complexity, "path": path},
    )


def update_artist_enrichment(name: str, data: dict, *, session=None):
    """Update artist enrichment data. Only updates fields that have non-None values
    to avoid overwriting existing data when a source fails."""
    now = datetime.now(timezone.utc).isoformat()

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

    updates = {k: v for k, v in field_map.items() if v is not None}
    updates["enriched_at"] = now

    if not updates:
        return

    set_clause = ", ".join(f"{k} = :f_{k}" for k in updates)
    params = {f"f_{k}": v for k, v in updates.items()}
    params["name"] = name

    if session is None:
        with transaction_scope() as s:
            return update_artist_enrichment(name, data, session=s)
    session.execute(text(f"UPDATE library_artists SET {set_clause} WHERE name = :name"), params)


def delete_artist(name: str, *, session=None):
    if session is None:
        with transaction_scope() as s:
            return delete_artist(name, session=s)
    rows = session.execute(text("SELECT id FROM library_albums WHERE artist = :name"), {"name": name}).mappings().all()
    album_ids = [r["id"] for r in rows]
    for aid in album_ids:
        session.execute(text("DELETE FROM library_tracks WHERE album_id = :album_id"), {"album_id": aid})
    session.execute(text("DELETE FROM library_albums WHERE artist = :name"), {"name": name})
    session.execute(text("DELETE FROM library_artists WHERE name = :name"), {"name": name})


def delete_album(path: str, *, session=None):
    if session is None:
        with transaction_scope() as s:
            return delete_album(path, session=s)
    row = session.execute(text("SELECT id FROM library_albums WHERE path = :path"), {"path": path}).mappings().first()
    if row:
        session.execute(text("DELETE FROM library_tracks WHERE album_id = :album_id"), {"album_id": row["id"]})
        session.execute(text("DELETE FROM library_albums WHERE path = :path"), {"path": path})


def delete_track(path: str, *, session=None):
    if session is None:
        with transaction_scope() as s:
            return delete_track(path, session=s)
    session.execute(text("DELETE FROM library_tracks WHERE path = :path"), {"path": path})


# ── Library helpers ──────────────────────────────────────────────

def set_track_rating(track_id: int, rating: int, *, session=None) -> None:
    """Set rating (0-5) for a track."""
    if session is None:
        with transaction_scope() as s:
            return set_track_rating(track_id, rating, session=s)
    session.execute(
        text("UPDATE library_tracks SET rating = :rating WHERE id = :track_id"),
        {"rating": max(0, min(5, rating)), "track_id": track_id},
    )


def update_artist_has_photo(name: str, *, session=None):
    """Set has_photo = 1 for an artist."""
    if session is None:
        with transaction_scope() as s:
            return update_artist_has_photo(name, session=s)
    session.execute(text("UPDATE library_artists SET has_photo = 1 WHERE name = :name"), {"name": name})


def get_track_rating(track_id: int) -> int:
    with transaction_scope() as session:
        row = session.execute(text("SELECT rating FROM library_tracks WHERE id = :track_id"), {"track_id": track_id}).mappings().first()
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


def get_track_path_by_id(track_id: int) -> str | None:
    """Return the path of a track by its ID, or None if not found."""
    with transaction_scope() as session:
        row = session.execute(text("SELECT path FROM library_tracks WHERE id = :track_id"), {"track_id": track_id}).mappings().first()
    return row["path"] if row else None


def get_artist_analysis_tracks(artist_name: str) -> list[dict]:
    """Return audio analysis data for all analyzed tracks of an artist."""
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT t.title, t.bpm AS tempo, t.audio_key AS key, t.audio_scale AS scale,
                   t.energy, t.danceability, t.valence, t.acousticness,
                   t.instrumentalness, t.loudness, t.dynamic_range,
                   t.spectral_complexity, t.mood_json
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE a.artist = :artist_name AND t.bpm IS NOT NULL
        """), {"artist_name": artist_name}).mappings().all()
        return [dict(r) for r in rows]


def get_artist_refs_by_names(names: list[str]) -> dict[str, dict]:
    """Look up artist id/slug by lowercase name. Returns {lowercase_name: {id, slug}}."""
    if not names:
        return {}
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT id, slug, name
            FROM library_artists
            WHERE LOWER(name) = ANY(:names)
            """),
            {"names": [name.lower() for name in names]},
        ).mappings().all()
        return {
            row["name"].lower(): {"id": row.get("id"), "slug": row.get("slug")}
            for row in rows
        }


def get_artist_tracks_for_setlist(artist_name: str) -> list[dict]:
    """Return tracks for an artist ordered for setlist matching."""
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT
                t.id,
                t.title,
                t.path,
                t.duration,
                a.name AS album
            FROM library_tracks t
            JOIN library_albums a ON a.id = t.album_id
            WHERE a.artist = :artist_name
            ORDER BY a.year NULLS LAST, a.name, t.disc_number NULLS LAST, t.track_number NULLS LAST, t.title
            """),
            {"artist_name": artist_name},
        ).mappings().all()
        return [dict(row) for row in rows]


def find_user_playlist_by_name(user_id: int, playlist_name: str) -> dict | None:
    """Find a user's playlist by exact name, most recently updated."""
    with transaction_scope() as session:
        row = session.execute(
            text("""
            SELECT id
            FROM playlists
            WHERE user_id = :user_id
              AND scope = 'user'
              AND name = :playlist_name
            ORDER BY updated_at DESC NULLS LAST, id DESC
            LIMIT 1
            """),
            {"user_id": user_id, "playlist_name": playlist_name},
        ).mappings().first()
        return dict(row) if row else None


def get_albums_missing_covers() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT name, artist, year, musicbrainz_albumid, path "
                 "FROM library_albums WHERE has_cover = 0 OR has_cover IS NULL "
                 "ORDER BY artist, year")
        ).mappings().all()
        return [dict(r) for r in rows]


def get_release_by_id(release_id: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT * FROM new_releases WHERE id = :release_id"), {"release_id": release_id}).mappings().first()
        return dict(row) if row else None


def enrich_track_refs(track_ids: list[int]) -> dict[int, dict]:
    if not track_ids:
        return {}
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT
                t.id AS track_id,
                t.storage_id::text AS track_storage_id,
                t.slug AS track_slug,
                a.id AS album_id,
                a.slug AS album_slug,
                ar.id AS artist_id,
                ar.slug AS artist_slug
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            LEFT JOIN library_artists ar ON ar.name = a.artist
            WHERE t.id = ANY(:track_ids)
            """),
            {"track_ids": track_ids},
        ).mappings().all()
        return {row["track_id"]: dict(row) for row in rows}
