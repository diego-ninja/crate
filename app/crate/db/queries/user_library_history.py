from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.user_library_shared import has_legacy_stream_id_column, relative_track_path
from crate.db.tx import read_scope


def get_play_history_rows(user_id: int, *, limit: int, has_legacy_stream_id_column: bool) -> list[dict]:
    query_sql = """
        SELECT
            COALESCE(lt.id, ph.track_id) AS track_id,
            lt.storage_id AS track_storage_id,
            COALESCE(lt.path, ph.track_path) AS track_path,
            COALESCE(lt.title, ph.title) AS title,
            COALESCE(lt.artist, ph.artist) AS artist,
            ar.id AS artist_id,
            ar.slug AS artist_slug,
            COALESCE(lt.album, ph.album) AS album,
            alb.id AS album_id,
            alb.slug AS album_slug,
            ph.played_at
        FROM play_history ph
        LEFT JOIN library_tracks lt
          ON lt.id = ph.track_id
    """
    if has_legacy_stream_id_column:
        query_sql += """
          OR (ph.track_id IS NULL AND lt.navidrome_id = ph.track_path)
          OR (ph.track_id IS NULL AND lt.path = ph.track_path)
        """
    else:
        query_sql += """
          OR (ph.track_id IS NULL AND lt.path = ph.track_path)
        """
    query_sql += """
        LEFT JOIN library_albums alb ON alb.id = lt.album_id
        LEFT JOIN library_artists ar ON ar.name = COALESCE(lt.artist, ph.artist)
        WHERE ph.user_id = :user_id
        ORDER BY ph.played_at DESC
        LIMIT :lim
    """

    with read_scope() as session:
        rows = session.execute(text(query_sql), {"user_id": user_id, "lim": limit}).mappings().all()
    return [dict(row) for row in rows]


def resolve_play_history_album_fallback(normalized_pairs: list[tuple[str, str]]) -> dict[tuple[str, str], dict]:
    if not normalized_pairs:
        return {}

    params: dict[str, object] = {}
    values_sql: list[str] = []
    for pair_idx, (artist_name, title_name) in enumerate(normalized_pairs):
        artist_key = f"artist_{pair_idx}"
        title_key = f"title_{pair_idx}"
        params[artist_key] = artist_name
        params[title_key] = title_name
        values_sql.append(f"(:{artist_key}, :{title_key})")

    with read_scope() as session:
        fallback_rows = session.execute(
            text(
                f"""
                WITH input_pairs(artist, title) AS (
                    VALUES {", ".join(values_sql)}
                )
                SELECT DISTINCT ON (LOWER(lt.artist), LOWER(lt.title))
                    lt.id AS track_id,
                    lt.storage_id AS track_storage_id,
                    lt.path,
                    lt.title,
                    lt.artist,
                    alb.id AS album_id,
                    alb.slug AS album_slug,
                    alb.name AS album,
                    ar.id AS artist_id,
                    ar.slug AS artist_slug
                FROM library_tracks lt
                LEFT JOIN library_albums alb ON alb.id = lt.album_id
                LEFT JOIN library_artists ar ON ar.name = lt.artist
                JOIN input_pairs ip
                  ON LOWER(lt.artist) = ip.artist
                 AND LOWER(lt.title) = ip.title
                ORDER BY
                    LOWER(lt.artist),
                    LOWER(lt.title),
                    CASE WHEN alb.id IS NULL THEN 1 ELSE 0 END,
                    lt.id DESC
                """
            ),
            params,
        ).mappings().all()

    return {
        ((row["artist"] or "").lower(), (row["title"] or "").lower()): dict(row)
        for row in fallback_rows
    }


def get_play_history(user_id: int, limit: int = 50) -> list[dict]:
    rows_raw = get_play_history_rows(
        user_id,
        limit=limit,
        has_legacy_stream_id_column=has_legacy_stream_id_column(),
    )
    rows: list[dict] = []
    needs_title_fallback: list[tuple[int, str, str]] = []
    for idx, item in enumerate(rows_raw):
        item["relative_path"] = relative_track_path(item.get("track_path") or "")
        rows.append(item)
        if item.get("album_id") is None and item.get("artist") and item.get("title"):
            needs_title_fallback.append((idx, item["artist"], item["title"]))

    normalized_pairs = list(
        dict.fromkeys(
            (
                (artist or "").strip().lower(),
                (title or "").strip().lower(),
            )
            for _, artist, title in needs_title_fallback
            if (artist or "").strip() and (title or "").strip()
        )
    )
    resolved = resolve_play_history_album_fallback(normalized_pairs)
    for idx, artist, title in needs_title_fallback:
        hit = resolved.get((artist.lower(), title.lower()))
        if not hit:
            continue
        item = rows[idx]
        item["track_id"] = hit["track_id"]
        item["track_storage_id"] = hit.get("track_storage_id")
        item["track_path"] = item.get("track_path") or hit.get("path")
        item["album_id"] = hit.get("album_id")
        item["album_slug"] = hit.get("album_slug")
        item["album"] = item.get("album") or hit.get("album")
        item["artist_id"] = item.get("artist_id") or hit.get("artist_id")
        item["artist_slug"] = item.get("artist_slug") or hit.get("artist_slug")

    return rows


__all__ = [
    "get_play_history",
    "get_play_history_rows",
    "resolve_play_history_album_fallback",
]
