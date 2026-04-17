import logging
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

from crate.config import load_config
from crate.db.tx import transaction_scope
from sqlalchemy import text

log = logging.getLogger(__name__)

_STATS_WINDOWS: dict[str, int | None] = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
    "365d": 365,
    "all_time": None,
}


def _normalize_stats_window(window: str) -> str:
    candidate = (window or "30d").strip().lower()
    if candidate not in _STATS_WINDOWS:
        raise ValueError(f"Unsupported stats window: {window}")
    return candidate


@lru_cache(maxsize=1)
def _library_root() -> Path:
    try:
        return Path(load_config()["library_path"])
    except Exception:
        return Path("/music")


def _relative_track_path(track_path: str) -> str:
    if not track_path:
        return ""

    library_root = str(_library_root()).rstrip("/")
    normalized = track_path.strip()
    if library_root and normalized.startswith(f"{library_root}/"):
        return normalized[len(library_root) + 1 :]
    if normalized.startswith("/music/"):
        return normalized[len("/music/") :]
    if not normalized.startswith("/"):
        return normalized
    return ""


@lru_cache(maxsize=1)
def _has_legacy_stream_id_column() -> bool:
    with transaction_scope() as session:
        row = session.execute(
            text("""
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'library_tracks'
              AND column_name = 'navidrome_id'
            LIMIT 1
            """)
        ).mappings().first()
        return row is not None


def _resolve_track_id(
    session,
    track_id: int | None = None,
    track_path: str | None = None,
    track_storage_id: str | None = None,
) -> int | None:
    if track_id is not None:
        row = session.execute(text("SELECT id FROM library_tracks WHERE id = :track_id"), {"track_id": track_id}).mappings().first()
        if row:
            return row["id"]

    if track_storage_id:
        row = session.execute(text("SELECT id FROM library_tracks WHERE storage_id = :storage_id"), {"storage_id": track_storage_id}).mappings().first()
        if row:
            return row["id"]

    if not track_path:
        return None

    relative_path = _relative_track_path(track_path)
    library_root = str(_library_root()).rstrip("/")
    absolute_candidate = f"{library_root}/{relative_path}" if library_root and relative_path else track_path
    music_candidate = f"/music/{relative_path}" if relative_path else track_path

    should_match_external_id = "/" not in track_path and "\\" not in track_path
    if should_match_external_id and _has_legacy_stream_id_column():
        row = session.execute(
            text("""
            SELECT id
            FROM library_tracks
            WHERE path = :track_path
               OR path = :absolute_candidate
               OR path = :music_candidate
               OR navidrome_id = :navidrome_id
            ORDER BY CASE
                WHEN path = :track_path2 THEN 0
                WHEN path = :absolute_candidate2 THEN 1
                WHEN path = :music_candidate2 THEN 2
                ELSE 3
            END
            LIMIT 1
            """),
            {
                "track_path": track_path,
                "absolute_candidate": absolute_candidate,
                "music_candidate": music_candidate,
                "navidrome_id": track_path,
                "track_path2": track_path,
                "absolute_candidate2": absolute_candidate,
                "music_candidate2": music_candidate,
            },
        ).mappings().first()
    else:
        row = session.execute(
            text("""
            SELECT id
            FROM library_tracks
            WHERE path = :track_path
               OR path = :absolute_candidate
               OR path = :music_candidate
            ORDER BY CASE
                WHEN path = :track_path2 THEN 0
                WHEN path = :absolute_candidate2 THEN 1
                WHEN path = :music_candidate2 THEN 2
                ELSE 3
            END
            LIMIT 1
            """),
            {
                "track_path": track_path,
                "absolute_candidate": absolute_candidate,
                "music_candidate": music_candidate,
                "track_path2": track_path,
                "absolute_candidate2": absolute_candidate,
                "music_candidate2": music_candidate,
            },
        ).mappings().first()
    return row["id"] if row else None


# ── Follows ──────────────────────────────────────────────────

def follow_artist(user_id: int, artist_name: str) -> bool:
    """Follow an artist. Returns True if newly followed."""
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        result = session.execute(
            text("INSERT INTO user_follows (user_id, artist_name, created_at) VALUES (:user_id, :artist_name, :created_at) ON CONFLICT DO NOTHING"),
            {"user_id": user_id, "artist_name": artist_name, "created_at": now})
        return result.rowcount > 0


def unfollow_artist(user_id: int, artist_name: str) -> bool:
    with transaction_scope() as session:
        result = session.execute(
            text("DELETE FROM user_follows WHERE user_id = :user_id AND artist_name = :artist_name"),
            {"user_id": user_id, "artist_name": artist_name})
        return result.rowcount > 0


def get_followed_artists(user_id: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT
                uf.artist_name,
                uf.created_at,
                la.id AS artist_id,
                la.slug AS artist_slug,
                la.album_count,
                la.track_count,
                la.has_photo
            FROM user_follows uf
            LEFT JOIN library_artists la ON la.name = uf.artist_name
            WHERE uf.user_id = :user_id
            ORDER BY uf.created_at DESC
        """), {"user_id": user_id}).mappings().all()
        return [dict(r) for r in rows]


def is_following(user_id: int, artist_name: str) -> bool:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT 1 FROM user_follows WHERE user_id = :user_id AND artist_name = :artist_name"),
            {"user_id": user_id, "artist_name": artist_name}).mappings().first()
        return row is not None


# ── Saved Albums ─────────────────────────────────────────────

def save_album(user_id: int, album_id: int) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        result = session.execute(
            text("INSERT INTO user_saved_albums (user_id, album_id, created_at) VALUES (:user_id, :album_id, :created_at) ON CONFLICT DO NOTHING"),
            {"user_id": user_id, "album_id": album_id, "created_at": now})
        return result.rowcount > 0


def unsave_album(user_id: int, album_id: int) -> bool:
    with transaction_scope() as session:
        result = session.execute(
            text("DELETE FROM user_saved_albums WHERE user_id = :user_id AND album_id = :album_id"),
            {"user_id": user_id, "album_id": album_id})
        return result.rowcount > 0


def get_saved_albums(user_id: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT
                usa.created_at AS saved_at,
                la.id,
                la.slug,
                la.artist,
                art.id AS artist_id,
                art.slug AS artist_slug,
                la.name,
                la.year,
                la.has_cover,
                la.track_count,
                la.total_duration
            FROM user_saved_albums usa
            JOIN library_albums la ON la.id = usa.album_id
            LEFT JOIN library_artists art ON art.name = la.artist
            WHERE usa.user_id = :user_id
            ORDER BY usa.created_at DESC
        """), {"user_id": user_id}).mappings().all()
        return [dict(r) for r in rows]


def is_album_saved(user_id: int, album_id: int) -> bool:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT 1 FROM user_saved_albums WHERE user_id = :user_id AND album_id = :album_id"),
            {"user_id": user_id, "album_id": album_id}).mappings().first()
        return row is not None


# ── Liked Tracks ─────────────────────────────────────────────

def like_track(
    user_id: int,
    track_id: int | None = None,
    track_path: str | None = None,
    track_storage_id: str | None = None,
) -> bool | None:
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        resolved_track_id = _resolve_track_id(
            session,
            track_id=track_id,
            track_path=track_path,
            track_storage_id=track_storage_id,
        )
        if not resolved_track_id:
            return None
        result = session.execute(
            text("INSERT INTO user_liked_tracks (user_id, track_id, created_at) VALUES (:user_id, :track_id, :created_at) ON CONFLICT DO NOTHING"),
            {"user_id": user_id, "track_id": resolved_track_id, "created_at": now})
        return result.rowcount > 0


def unlike_track(
    user_id: int,
    track_id: int | None = None,
    track_path: str | None = None,
    track_storage_id: str | None = None,
) -> bool:
    with transaction_scope() as session:
        resolved_track_id = _resolve_track_id(
            session,
            track_id=track_id,
            track_path=track_path,
            track_storage_id=track_storage_id,
        )
        if not resolved_track_id:
            return False
        result = session.execute(
            text("DELETE FROM user_liked_tracks WHERE user_id = :user_id AND track_id = :track_id"),
            {"user_id": user_id, "track_id": resolved_track_id},
        )
        return result.rowcount > 0


def get_liked_tracks(user_id: int, limit: int = 100) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT
                ult.track_id,
                lt.storage_id AS track_storage_id,
                ult.created_at AS liked_at,
                lt.path,
                lt.title,
                lt.artist,
                ar.id AS artist_id,
                ar.slug AS artist_slug,
                lt.album,
                alb.id AS album_id,
                alb.slug AS album_slug,
                lt.duration
            FROM user_liked_tracks ult
            JOIN library_tracks lt ON lt.id = ult.track_id
            LEFT JOIN library_albums alb ON alb.id = lt.album_id
            LEFT JOIN library_artists ar ON ar.name = lt.artist
            WHERE ult.user_id = :user_id
            ORDER BY ult.created_at DESC
            LIMIT :lim
        """), {"user_id": user_id, "lim": limit}).mappings().all()
        result_rows = []
        for row in rows:
            item = dict(row)
            item["relative_path"] = _relative_track_path(item.get("path") or "")
            result_rows.append(item)
        return result_rows


def is_track_liked(
    user_id: int,
    track_id: int | None = None,
    track_path: str | None = None,
    track_storage_id: str | None = None,
) -> bool:
    with transaction_scope() as session:
        resolved_track_id = _resolve_track_id(
            session,
            track_id=track_id,
            track_path=track_path,
            track_storage_id=track_storage_id,
        )
        if not resolved_track_id:
            return False
        row = session.execute(
            text("SELECT 1 FROM user_liked_tracks WHERE user_id = :user_id AND track_id = :track_id"),
            {"user_id": user_id, "track_id": resolved_track_id}).mappings().first()
        return row is not None


# ── Play History ─────────────────────────────────────────────

def record_play(
    user_id: int,
    track_path: str = "",
    title: str = "",
    artist: str = "",
    album: str = "",
    track_id: int | None = None,
    track_storage_id: str | None = None,
):
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        resolved_track_id = _resolve_track_id(
            session,
            track_id=track_id,
            track_path=track_path,
            track_storage_id=track_storage_id,
        )
        session.execute(
            text("""
            INSERT INTO play_history (user_id, track_id, track_path, title, artist, album, played_at)
            VALUES (:user_id, :track_id, :track_path, :title, :artist, :album, :played_at)
            """),
            {"user_id": user_id, "track_id": resolved_track_id, "track_path": track_path,
             "title": title, "artist": artist, "album": album, "played_at": now},
        )


def record_play_event(
    user_id: int,
    *,
    track_id: int | None = None,
    track_path: str | None = None,
    track_storage_id: str | None = None,
    title: str = "",
    artist: str = "",
    album: str = "",
    started_at: str,
    ended_at: str,
    played_seconds: float,
    track_duration_seconds: float | None = None,
    completion_ratio: float | None = None,
    was_skipped: bool = False,
    was_completed: bool = False,
    play_source_type: str | None = None,
    play_source_id: str | None = None,
    play_source_name: str | None = None,
    context_artist: str | None = None,
    context_album: str | None = None,
    context_playlist_id: int | None = None,
    device_type: str | None = None,
    app_platform: str | None = None,
) -> int:
    created_at = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        resolved_track_id = _resolve_track_id(
            session,
            track_id=track_id,
            track_path=track_path,
            track_storage_id=track_storage_id,
        )
        row = session.execute(
            text("""
            INSERT INTO user_play_events (
                user_id,
                track_id,
                track_path,
                title,
                artist,
                album,
                started_at,
                ended_at,
                played_seconds,
                track_duration_seconds,
                completion_ratio,
                was_skipped,
                was_completed,
                play_source_type,
                play_source_id,
                play_source_name,
                context_artist,
                context_album,
                context_playlist_id,
                device_type,
                app_platform,
                created_at
            )
            VALUES (
                :user_id, :track_id, :track_path, :title, :artist, :album,
                :started_at, :ended_at, :played_seconds, :track_duration_seconds,
                :completion_ratio, :was_skipped, :was_completed,
                :play_source_type, :play_source_id, :play_source_name,
                :context_artist, :context_album, :context_playlist_id,
                :device_type, :app_platform, :created_at
            )
            RETURNING id
            """),
            {
                "user_id": user_id,
                "track_id": resolved_track_id,
                "track_path": track_path,
                "title": title,
                "artist": artist,
                "album": album,
                "started_at": started_at,
                "ended_at": ended_at,
                "played_seconds": played_seconds,
                "track_duration_seconds": track_duration_seconds,
                "completion_ratio": completion_ratio,
                "was_skipped": was_skipped,
                "was_completed": was_completed,
                "play_source_type": play_source_type,
                "play_source_id": play_source_id,
                "play_source_name": play_source_name,
                "context_artist": context_artist,
                "context_album": context_album,
                "context_playlist_id": context_playlist_id,
                "device_type": device_type,
                "app_platform": app_platform,
                "created_at": created_at,
            },
        ).mappings().first()
        event_id = row["id"]

        if was_completed and title and artist:
            try:
                from crate.scrobble import scrobble_play_event
                scrobble_play_event(
                    user_id,
                    artist=artist,
                    track=title,
                    album=album,
                    timestamp=int(datetime.fromisoformat(started_at).timestamp()) if started_at else None,
                )
            except Exception:
                pass

        return event_id


def _window_cutoff(days: int | None) -> str | None:
    if days is None:
        return None
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _window_day_cutoff(window: str) -> str | None:
    normalized = _normalize_stats_window(window)
    days = _STATS_WINDOWS[normalized]
    if days is None:
        return None
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _recompute_user_listening_aggregates(session, user_id: int):
    _recompute_user_daily_listening(session, user_id)
    for window, days in _STATS_WINDOWS.items():
        cutoff = _window_cutoff(days)
        _recompute_user_track_stats(session, user_id, window, cutoff)
        _recompute_user_artist_stats(session, user_id, window, cutoff)
        _recompute_user_album_stats(session, user_id, window, cutoff)
        _recompute_user_genre_stats(session, user_id, window, cutoff)


def recompute_user_listening_aggregates(user_id: int) -> None:
    with transaction_scope() as session:
        _recompute_user_listening_aggregates(session, user_id)


def _recompute_user_daily_listening(session, user_id: int):
    session.execute(text("DELETE FROM user_daily_listening WHERE user_id = :user_id"), {"user_id": user_id})
    session.execute(
        text("""
        INSERT INTO user_daily_listening (
            user_id,
            day,
            play_count,
            complete_play_count,
            skip_count,
            minutes_listened,
            unique_tracks,
            unique_artists,
            unique_albums
        )
        SELECT
            user_id,
            (ended_at AT TIME ZONE 'UTC')::date AS day,
            COUNT(*)::INTEGER AS play_count,
            SUM(CASE WHEN was_completed THEN 1 ELSE 0 END)::INTEGER AS complete_play_count,
            SUM(CASE WHEN was_skipped THEN 1 ELSE 0 END)::INTEGER AS skip_count,
            COALESCE(SUM(played_seconds), 0) / 60.0 AS minutes_listened,
            COUNT(DISTINCT COALESCE(track_id::text, NULLIF(track_path, ''), 'unknown-track'))::INTEGER AS unique_tracks,
            COUNT(DISTINCT NULLIF(artist, ''))::INTEGER AS unique_artists,
            COUNT(DISTINCT NULLIF(CONCAT(COALESCE(artist, ''), '||', COALESCE(album, '')), '||'))::INTEGER AS unique_albums
        FROM user_play_events
        WHERE user_id = :user_id
        GROUP BY user_id, (ended_at AT TIME ZONE 'UTC')::date
        """),
        {"user_id": user_id},
    )


def _window_filter_sql(cutoff: str | None) -> tuple[str, dict]:
    if cutoff is None:
        return "upe.user_id = :filter_user_id", {}
    return "upe.user_id = :filter_user_id AND upe.ended_at >= :cutoff", {"cutoff": cutoff}


def _recompute_user_track_stats(session, user_id: int, window: str, cutoff: str | None):
    session.execute(text("DELETE FROM user_track_stats WHERE user_id = :user_id AND stat_window = :window"), {"user_id": user_id, "window": window})
    where_sql, extra_params = _window_filter_sql(cutoff)
    params = {"user_id": user_id, "window": window, "filter_user_id": user_id, **extra_params}
    session.execute(
        text(f"""
        INSERT INTO user_track_stats (
            user_id,
            stat_window,
            entity_key,
            track_id,
            track_path,
            title,
            artist,
            album,
            play_count,
            complete_play_count,
            minutes_listened,
            first_played_at,
            last_played_at
        )
        SELECT
            :user_id,
            :window,
            COALESCE(upe.track_id::text, NULLIF(upe.track_path, ''), 'unknown-track') AS entity_key,
            MAX(upe.track_id) AS track_id,
            MAX(upe.track_path) AS track_path,
            MAX(upe.title) AS title,
            MAX(upe.artist) AS artist,
            MAX(upe.album) AS album,
            COUNT(*)::INTEGER AS play_count,
            SUM(CASE WHEN upe.was_completed THEN 1 ELSE 0 END)::INTEGER AS complete_play_count,
            COALESCE(SUM(upe.played_seconds), 0) / 60.0 AS minutes_listened,
            MIN(upe.started_at) AS first_played_at,
            MAX(upe.ended_at) AS last_played_at
        FROM user_play_events upe
        WHERE {where_sql}
          AND (upe.track_id IS NOT NULL OR COALESCE(upe.track_path, '') != '')
        GROUP BY COALESCE(upe.track_id::text, NULLIF(upe.track_path, ''), 'unknown-track')
        """),
        params,
    )


def _recompute_user_artist_stats(session, user_id: int, window: str, cutoff: str | None):
    session.execute(text("DELETE FROM user_artist_stats WHERE user_id = :user_id AND stat_window = :window"), {"user_id": user_id, "window": window})
    where_sql, extra_params = _window_filter_sql(cutoff)
    params = {"user_id": user_id, "window": window, "filter_user_id": user_id, **extra_params}
    session.execute(
        text(f"""
        INSERT INTO user_artist_stats (
            user_id,
            stat_window,
            artist_name,
            play_count,
            complete_play_count,
            minutes_listened,
            first_played_at,
            last_played_at
        )
        SELECT
            :user_id,
            :window,
            upe.artist AS artist_name,
            COUNT(*)::INTEGER AS play_count,
            SUM(CASE WHEN upe.was_completed THEN 1 ELSE 0 END)::INTEGER AS complete_play_count,
            COALESCE(SUM(upe.played_seconds), 0) / 60.0 AS minutes_listened,
            MIN(upe.started_at) AS first_played_at,
            MAX(upe.ended_at) AS last_played_at
        FROM user_play_events upe
        WHERE {where_sql}
          AND COALESCE(upe.artist, '') != ''
        GROUP BY upe.artist
        """),
        params,
    )


def _recompute_user_album_stats(session, user_id: int, window: str, cutoff: str | None):
    session.execute(text("DELETE FROM user_album_stats WHERE user_id = :user_id AND stat_window = :window"), {"user_id": user_id, "window": window})
    where_sql, extra_params = _window_filter_sql(cutoff)
    params = {"user_id": user_id, "window": window, "filter_user_id": user_id, **extra_params}
    session.execute(
        text(f"""
        INSERT INTO user_album_stats (
            user_id,
            stat_window,
            entity_key,
            artist,
            album,
            play_count,
            complete_play_count,
            minutes_listened,
            first_played_at,
            last_played_at
        )
        SELECT
            :user_id,
            :window,
            CONCAT(COALESCE(upe.artist, ''), '||', COALESCE(upe.album, '')) AS entity_key,
            MAX(upe.artist) AS artist,
            MAX(upe.album) AS album,
            COUNT(*)::INTEGER AS play_count,
            SUM(CASE WHEN upe.was_completed THEN 1 ELSE 0 END)::INTEGER AS complete_play_count,
            COALESCE(SUM(upe.played_seconds), 0) / 60.0 AS minutes_listened,
            MIN(upe.started_at) AS first_played_at,
            MAX(upe.ended_at) AS last_played_at
        FROM user_play_events upe
        WHERE {where_sql}
          AND COALESCE(upe.album, '') != ''
        GROUP BY CONCAT(COALESCE(upe.artist, ''), '||', COALESCE(upe.album, ''))
        """),
        params,
    )


def _recompute_user_genre_stats(session, user_id: int, window: str, cutoff: str | None):
    session.execute(text("DELETE FROM user_genre_stats WHERE user_id = :user_id AND stat_window = :window"), {"user_id": user_id, "window": window})
    where_sql, extra_params = _window_filter_sql(cutoff)
    params = {"user_id": user_id, "window": window, "filter_user_id": user_id, **extra_params}
    session.execute(
        text(f"""
        INSERT INTO user_genre_stats (
            user_id,
            stat_window,
            genre_name,
            play_count,
            complete_play_count,
            minutes_listened,
            first_played_at,
            last_played_at
        )
        SELECT
            :user_id,
            :window,
            lt.genre AS genre_name,
            COUNT(*)::INTEGER AS play_count,
            SUM(CASE WHEN upe.was_completed THEN 1 ELSE 0 END)::INTEGER AS complete_play_count,
            COALESCE(SUM(upe.played_seconds), 0) / 60.0 AS minutes_listened,
            MIN(upe.started_at) AS first_played_at,
            MAX(upe.ended_at) AS last_played_at
        FROM user_play_events upe
        LEFT JOIN library_tracks lt
          ON lt.id = upe.track_id
          OR (upe.track_id IS NULL AND COALESCE(upe.track_path, '') != '' AND lt.path = upe.track_path)
        WHERE {where_sql}
          AND COALESCE(lt.genre, '') != ''
        GROUP BY lt.genre
        """),
        params,
    )


def get_play_history(user_id: int, limit: int = 50) -> list[dict]:
    with transaction_scope() as session:
        if _has_legacy_stream_id_column():
            rows_raw = session.execute(
                text("""
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
                  OR (ph.track_id IS NULL AND lt.navidrome_id = ph.track_path)
                  OR (ph.track_id IS NULL AND lt.path = ph.track_path)
                LEFT JOIN library_albums alb ON alb.id = lt.album_id
                LEFT JOIN library_artists ar ON ar.name = COALESCE(lt.artist, ph.artist)
                WHERE ph.user_id = :user_id
                ORDER BY ph.played_at DESC
                LIMIT :lim
                """),
                {"user_id": user_id, "lim": limit},
            ).mappings().all()
        else:
            rows_raw = session.execute(
                text("""
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
                  OR (ph.track_id IS NULL AND lt.path = ph.track_path)
                LEFT JOIN library_albums alb ON alb.id = lt.album_id
                LEFT JOIN library_artists ar ON ar.name = COALESCE(lt.artist, ph.artist)
                WHERE ph.user_id = :user_id
                ORDER BY ph.played_at DESC
                LIMIT :lim
                """),
                {"user_id": user_id, "lim": limit},
            ).mappings().all()
        rows: list[dict] = []
        needs_title_fallback: list[tuple[int, str, str]] = []
        for idx, row in enumerate(rows_raw):
            item = dict(row)
            item["relative_path"] = _relative_track_path(item.get("track_path") or "")
            rows.append(item)
            if item.get("album_id") is None and item.get("artist") and item.get("title"):
                needs_title_fallback.append((idx, item["artist"], item["title"]))

        if needs_title_fallback:
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
            fallback_rows: list[dict] = []
            if normalized_pairs:
                params: dict[str, object] = {}
                values_sql: list[str] = []
                for pair_idx, (artist_name, title_name) in enumerate(normalized_pairs):
                    artist_key = f"artist_{pair_idx}"
                    title_key = f"title_{pair_idx}"
                    params[artist_key] = artist_name
                    params[title_key] = title_name
                    values_sql.append(f"(:{artist_key}, :{title_key})")

                fallback_rows = session.execute(
                    text(f"""
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
                    """),
                    params,
                ).mappings().all()
            resolved = {
                ((r["artist"] or "").lower(), (r["title"] or "").lower()): dict(r)
                for r in fallback_rows
            }
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


def get_play_stats(user_id: int) -> dict:
    """Get listening stats for a user."""
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT COALESCE(SUM(play_count), 0) AS total_plays FROM user_daily_listening WHERE user_id = :user_id"),
            {"user_id": user_id},
        ).mappings().first()
        total = row["total_plays"]
        top_artists_rows = session.execute(
            text("""
            SELECT artist_name AS artist, play_count AS plays
            FROM user_artist_stats
            WHERE user_id = :user_id AND stat_window = 'all_time'
            ORDER BY play_count DESC, minutes_listened DESC, artist_name ASC
            LIMIT 10
            """),
            {"user_id": user_id},
        ).mappings().all()
        top_artists = [dict(r) for r in top_artists_rows]

        if not total and not top_artists:
            log.info("Falling back to legacy play_history for user %s stats", user_id)
            row = session.execute(
                text("SELECT COUNT(*) AS total_plays FROM play_history WHERE user_id = :user_id"),
                {"user_id": user_id},
            ).mappings().first()
            total = row["total_plays"]
            top_artists_rows = session.execute(text("""
                SELECT artist, COUNT(*) AS plays FROM play_history ph
                WHERE user_id = :user_id GROUP BY artist ORDER BY plays DESC LIMIT 10
            """), {"user_id": user_id}).mappings().all()
            top_artists = [dict(r) for r in top_artists_rows]

    return {"total_plays": total, "top_artists": top_artists}


def get_stats_overview(user_id: int, window: str = "30d") -> dict:
    normalized = _normalize_stats_window(window)
    day_cutoff = _window_day_cutoff(normalized)
    with transaction_scope() as session:
        if day_cutoff is None:
            overview_row = session.execute(
                text("""
                SELECT
                    COALESCE(SUM(play_count), 0) AS play_count,
                    COALESCE(SUM(complete_play_count), 0) AS complete_play_count,
                    COALESCE(SUM(skip_count), 0) AS skip_count,
                    COALESCE(SUM(minutes_listened), 0) AS minutes_listened,
                    COUNT(*)::INTEGER AS active_days
                FROM user_daily_listening
                WHERE user_id = :user_id
                """),
                {"user_id": user_id},
            ).mappings().first()
        else:
            overview_row = session.execute(
                text("""
                SELECT
                    COALESCE(SUM(play_count), 0) AS play_count,
                    COALESCE(SUM(complete_play_count), 0) AS complete_play_count,
                    COALESCE(SUM(skip_count), 0) AS skip_count,
                    COALESCE(SUM(minutes_listened), 0) AS minutes_listened,
                    COUNT(*)::INTEGER AS active_days
                FROM user_daily_listening
                WHERE user_id = :user_id AND day >= :day_cutoff
                """),
                {"user_id": user_id, "day_cutoff": day_cutoff},
            ).mappings().first()
        overview = dict(overview_row or {})

        top_artist_row = session.execute(
            text("""
            SELECT artist_name, play_count, minutes_listened
            FROM user_artist_stats
            WHERE user_id = :user_id AND stat_window = :window
            ORDER BY play_count DESC, minutes_listened DESC, artist_name ASC
            LIMIT 1
            """),
            {"user_id": user_id, "window": normalized},
        ).mappings().first()
        top_artist = None
        if top_artist_row:
            top_artist = dict(top_artist_row)
            artist_ref = session.execute(
                text("SELECT id, slug FROM library_artists WHERE name = :name"),
                {"name": top_artist["artist_name"]},
            ).mappings().first()
            if artist_ref:
                top_artist["artist_id"] = artist_ref["id"]
                top_artist["artist_slug"] = artist_ref["slug"]

    play_count = overview.get("play_count", 0) or 0
    skip_count = overview.get("skip_count", 0) or 0
    return {
        "window": normalized,
        "play_count": play_count,
        "complete_play_count": overview.get("complete_play_count", 0) or 0,
        "skip_count": skip_count,
        "minutes_listened": overview.get("minutes_listened", 0) or 0,
        "active_days": overview.get("active_days", 0) or 0,
        "skip_rate": (skip_count / play_count) if play_count else 0,
        "top_artist": dict(top_artist) if top_artist else None,
    }


def get_stats_trends(user_id: int, window: str = "30d") -> dict:
    normalized = _normalize_stats_window(window)
    day_cutoff = _window_day_cutoff(normalized)
    with transaction_scope() as session:
        if day_cutoff is None:
            rows = session.execute(
                text("""
                SELECT day, play_count, complete_play_count, skip_count, minutes_listened
                FROM user_daily_listening
                WHERE user_id = :user_id
                ORDER BY day ASC
                """),
                {"user_id": user_id},
            ).mappings().all()
        else:
            rows = session.execute(
                text("""
                SELECT day, play_count, complete_play_count, skip_count, minutes_listened
                FROM user_daily_listening
                WHERE user_id = :user_id AND day >= :day_cutoff
                ORDER BY day ASC
                """),
                {"user_id": user_id, "day_cutoff": day_cutoff},
            ).mappings().all()
        rows = [dict(row) for row in rows]
    return {"window": normalized, "points": rows}


def get_top_tracks(user_id: int, window: str = "30d", limit: int = 20) -> list[dict]:
    normalized = _normalize_stats_window(window)
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT
                uts.track_id,
                lt.storage_id::text AS track_storage_id,
                COALESCE(lt.path, uts.track_path) AS track_path,
                COALESCE(lt.title, uts.title) AS title,
                COALESCE(lt.artist, uts.artist) AS artist,
                COALESCE(lt.album, uts.album) AS album,
                art.id AS artist_id,
                art.slug AS artist_slug,
                COALESCE(alb_by_id.id, alb_by_name.id) AS album_id,
                COALESCE(alb_by_id.slug, alb_by_name.slug) AS album_slug,
                uts.play_count,
                uts.complete_play_count,
                uts.minutes_listened,
                uts.first_played_at,
                uts.last_played_at
            FROM user_track_stats uts
            LEFT JOIN library_tracks lt ON lt.id = uts.track_id
            LEFT JOIN library_albums alb_by_id ON alb_by_id.id = lt.album_id
            LEFT JOIN library_albums alb_by_name
              ON alb_by_id.id IS NULL
             AND alb_by_name.artist = COALESCE(lt.artist, uts.artist)
             AND alb_by_name.name = COALESCE(lt.album, uts.album)
            LEFT JOIN library_artists art ON art.name = COALESCE(lt.artist, uts.artist)
            WHERE uts.user_id = :user_id AND uts.stat_window = :window
            ORDER BY uts.play_count DESC, uts.minutes_listened DESC, uts.last_played_at DESC
            LIMIT :lim
            """),
            {"user_id": user_id, "window": normalized, "lim": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


def get_top_artists(user_id: int, window: str = "30d", limit: int = 20) -> list[dict]:
    normalized = _normalize_stats_window(window)
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT
                uas.artist_name,
                la.id AS artist_id,
                la.slug AS artist_slug,
                play_count,
                complete_play_count,
                minutes_listened,
                first_played_at,
                last_played_at
            FROM user_artist_stats uas
            LEFT JOIN library_artists la ON la.name = uas.artist_name
            WHERE uas.user_id = :user_id AND uas.stat_window = :window
            ORDER BY play_count DESC, minutes_listened DESC, last_played_at DESC
            LIMIT :lim
            """),
            {"user_id": user_id, "window": normalized, "lim": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


def get_top_albums(user_id: int, window: str = "30d", limit: int = 20) -> list[dict]:
    normalized = _normalize_stats_window(window)
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT
                uas.artist,
                art.id AS artist_id,
                art.slug AS artist_slug,
                uas.album,
                alb.id AS album_id,
                alb.slug AS album_slug,
                uas.play_count,
                uas.complete_play_count,
                uas.minutes_listened,
                uas.first_played_at,
                uas.last_played_at
            FROM user_album_stats uas
            LEFT JOIN library_albums alb ON alb.artist = uas.artist AND alb.name = uas.album
            LEFT JOIN library_artists art ON art.name = uas.artist
            WHERE uas.user_id = :user_id AND uas.stat_window = :window
            ORDER BY uas.play_count DESC, uas.minutes_listened DESC, uas.last_played_at DESC
            LIMIT :lim
            """),
            {"user_id": user_id, "window": normalized, "lim": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


def get_top_genres(user_id: int, window: str = "30d", limit: int = 20) -> list[dict]:
    normalized = _normalize_stats_window(window)
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT
                genre_name,
                play_count,
                complete_play_count,
                minutes_listened,
                first_played_at,
                last_played_at
            FROM user_genre_stats
            WHERE user_id = :user_id AND stat_window = :window
            ORDER BY play_count DESC, minutes_listened DESC, last_played_at DESC
            LIMIT :lim
            """),
            {"user_id": user_id, "window": normalized, "lim": limit},
        ).mappings().all()
        return [dict(row) for row in rows]


def get_replay_mix(user_id: int, window: str = "30d", limit: int = 30) -> dict:
    normalized = _normalize_stats_window(window)
    candidate_limit = max(limit * 4, 60)
    candidates = get_top_tracks(user_id, window=normalized, limit=candidate_limit)

    items: list[dict] = []
    artist_counts: dict[str, int] = {}
    for row in candidates:
        artist_name = row.get("artist") or ""
        if artist_name and artist_counts.get(artist_name, 0) >= 4:
            continue
        items.append(row)
        if artist_name:
            artist_counts[artist_name] = artist_counts.get(artist_name, 0) + 1
        if len(items) >= limit:
            break

    if normalized == "7d":
        title = "Your last 7 days"
        subtitle = "A quick replay of the week so far."
    elif normalized == "30d":
        title = "Replay this month"
        subtitle = "The tracks that defined your last 30 days."
    elif normalized == "90d":
        title = "Replay this season"
        subtitle = "The songs you've kept coming back to lately."
    elif normalized == "365d":
        title = "Replay this year"
        subtitle = "A long-view mix from your past year."
    else:
        title = "All-time replay"
        subtitle = "Your enduring favorites across the whole library."

    total_minutes = round(sum(float(item.get("minutes_listened") or 0) for item in items), 1)

    return {
        "window": normalized,
        "title": title,
        "subtitle": subtitle,
        "track_count": len(items),
        "minutes_listened": total_minutes,
        "items": items,
    }


# ── User Library Summary ─────────────────────────────────────

def get_user_library_counts(user_id: int) -> dict:
    with transaction_scope() as session:
        row = session.execute(
            text("""
            SELECT
                (SELECT COUNT(*) FROM user_follows WHERE user_id = :uid1) AS followed_artists,
                (SELECT COUNT(*) FROM user_saved_albums WHERE user_id = :uid2) AS saved_albums,
                (SELECT COUNT(*) FROM user_liked_tracks WHERE user_id = :uid3) AS liked_tracks,
                (SELECT COUNT(*) FROM playlists WHERE user_id = :uid4) AS playlists
            """),
            {"uid1": user_id, "uid2": user_id, "uid3": user_id, "uid4": user_id},
        ).mappings().first()
        return dict(row)
