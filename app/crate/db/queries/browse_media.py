from crate.db.tx import transaction_scope
from sqlalchemy import text


def search_artists(like: str, limit: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT id, slug, name, album_count, has_photo
            FROM library_artists
            WHERE name ILIKE :like
            ORDER BY listeners DESC NULLS LAST, album_count DESC, name ASC
            LIMIT :limit
            """),
            {"like": like, "limit": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


def search_albums(like: str, limit: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT a.id, a.slug, a.artist, a.name, a.year, a.has_cover,
                   ar.id AS artist_id, ar.slug AS artist_slug
            FROM library_albums a
            LEFT JOIN library_artists ar ON ar.name = a.artist
            WHERE a.name ILIKE :like OR a.artist ILIKE :like
            ORDER BY year DESC NULLS LAST, name ASC
            LIMIT :limit
            """),
            {"like": like, "limit": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


def search_tracks(like: str, limit: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT t.id, t.storage_id, t.slug, t.title, t.artist, a.id AS album_id, a.slug AS album_slug,
                   a.name AS album, ar.id AS artist_id, ar.slug AS artist_slug,
                   t.path, t.duration
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            LEFT JOIN library_artists ar ON ar.name = t.artist
            WHERE t.title ILIKE :like OR t.artist ILIKE :like OR a.name ILIKE :like
            ORDER BY t.title ASC
            LIMIT :limit
            """),
            {"like": like, "limit": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


def list_favorites() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("SELECT item_type, item_id, created_at FROM favorites ORDER BY created_at DESC")).mappings().all()
        return [dict(row) for row in rows]


def add_favorite(item_type: str, item_id: str, created_at: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("INSERT INTO favorites (item_type, item_id, created_at) VALUES (:item_type, :item_id, :created_at) ON CONFLICT DO NOTHING"),
            {"item_type": item_type, "item_id": item_id, "created_at": created_at},
        )


def remove_favorite(item_type: str, item_id: str) -> None:
    with transaction_scope() as session:
        session.execute(text("DELETE FROM favorites WHERE item_id = :item_id AND item_type = :item_type"), {"item_id": item_id, "item_type": item_type})


def find_track_id_by_path(path_like: str) -> int | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT id FROM library_tracks WHERE path LIKE :path_like LIMIT 1"), {"path_like": f"%{path_like}"}).mappings().first()
        return row["id"] if row else None


def _validate_cols(cols: str) -> str:
    """Validate that cols contains only safe column names (no SQL injection)."""
    import re
    if not re.match(r'^[a-z_,\s]+$', cols):
        raise ValueError(f"Invalid column list: {cols!r}")
    return cols


def get_track_info_cols(track_id: int, cols: str) -> dict | None:
    _validate_cols(cols)
    with transaction_scope() as session:
        row = session.execute(text(f"SELECT {cols} FROM library_tracks WHERE id = :track_id"), {"track_id": track_id}).mappings().first()
        return dict(row) if row else None


def get_track_info_cols_by_storage_id(storage_id: str, cols: str) -> dict | None:
    _validate_cols(cols)
    with transaction_scope() as session:
        row = session.execute(text(f"SELECT {cols} FROM library_tracks WHERE storage_id = :storage_id"), {"storage_id": storage_id}).mappings().first()
        return dict(row) if row else None


def get_track_info_cols_by_path(filepath: str, cols: str) -> dict | None:
    _validate_cols(cols)
    with transaction_scope() as session:
        row = session.execute(
            text(f"SELECT {cols} FROM library_tracks WHERE path LIKE :filepath LIMIT 1"),
            {"filepath": f"%{filepath}"},
        ).mappings().first()
        return dict(row) if row else None


def get_track_exists(track_id: int) -> bool:
    with transaction_scope() as session:
        row = session.execute(text("SELECT 1 FROM library_tracks WHERE id = :track_id"), {"track_id": track_id}).mappings().first()
        return row is not None


def get_track_id_by_storage_id(storage_id: str) -> int | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT id FROM library_tracks WHERE storage_id = :storage_id"), {"storage_id": storage_id}).mappings().first()
        return row["id"] if row else None


def get_track_album_genres(track_id: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT g.name, g.slug, ag.weight
            FROM library_tracks t
            JOIN album_genres ag ON ag.album_id = t.album_id
            JOIN genres g ON g.id = ag.genre_id
            WHERE t.id = :track_id
            ORDER BY ag.weight DESC NULLS LAST, g.name ASC
            LIMIT 10
            """),
            {"track_id": track_id},
        ).mappings().all()
        return [dict(row) for row in rows]


def get_track_artist_genres(track_id: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT g.name, g.slug, arg.weight
            FROM library_tracks t
            JOIN artist_genres arg ON arg.artist_name = t.artist
            JOIN genres g ON g.id = arg.genre_id
            WHERE t.id = :track_id
            ORDER BY arg.weight DESC NULLS LAST, g.name ASC
            LIMIT 10
            """),
            {"track_id": track_id},
        ).mappings().all()
        return [dict(row) for row in rows]


def get_track_path(track_id: int) -> str | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT path FROM library_tracks WHERE id = :track_id"), {"track_id": track_id}).mappings().first()
        return row["path"] if row else None


def get_track_path_by_storage_id(storage_id: str) -> str | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT path FROM library_tracks WHERE storage_id = :storage_id"), {"storage_id": storage_id}).mappings().first()
        return row["path"] if row else None


def _convert_mood_params(conditions: list[str], params: list) -> tuple[list[str], dict]:
    named_conditions = []
    named_params = {}
    param_idx = 0
    for cond in conditions:
        if "%s" in cond:
            param_name = f"p{param_idx}"
            named_conditions.append(cond.replace("%s", f":{param_name}", 1))
            named_params[param_name] = params[param_idx]
            param_idx += 1
        else:
            named_conditions.append(cond)
    return named_conditions, named_params


def count_mood_tracks(conditions: list[str], params: list) -> int:
    named_conditions, named_params = _convert_mood_params(conditions, params)
    with transaction_scope() as session:
        row = session.execute(
            text(f"SELECT COUNT(*) AS cnt FROM library_tracks WHERE {' AND '.join(named_conditions)}"),
            named_params,
        ).mappings().first()
        return row["cnt"]


def get_mood_tracks(conditions: list[str], params: list, limit: int) -> list[dict]:
    named_conditions, named_params = _convert_mood_params(conditions, params)
    named_params["limit"] = limit
    with transaction_scope() as session:
        rows = session.execute(
            text(f"""SELECT t.id, t.storage_id, t.title, t.artist, a.name AS album, t.path, t.duration,
                       ar.id AS artist_id, ar.slug AS artist_slug,
                       a.id AS album_id, a.slug AS album_slug,
                       t.bpm, t.energy, t.danceability, t.valence
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                LEFT JOIN library_artists ar ON ar.name = t.artist
                WHERE {' AND '.join(named_conditions)}
                ORDER BY RANDOM() LIMIT :limit"""),
            named_params,
        ).mappings().all()
        return [dict(r) for r in rows]
