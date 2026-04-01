from datetime import datetime, timedelta, timezone
from pathlib import Path

from crate.config import load_config
from crate.db.core import get_db_ctx

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


def _resolve_track_id(cur, track_id: int | None = None, track_path: str | None = None) -> int | None:
    if track_id:
        cur.execute("SELECT id FROM library_tracks WHERE id = %s", (track_id,))
        row = cur.fetchone()
        if row:
            return row["id"]

    if not track_path:
        return None

    relative_path = _relative_track_path(track_path)
    library_root = str(_library_root()).rstrip("/")
    absolute_candidate = f"{library_root}/{relative_path}" if library_root and relative_path else track_path
    music_candidate = f"/music/{relative_path}" if relative_path else track_path
    suffix_candidate = f"%/{relative_path}" if relative_path else ""

    cur.execute(
        """
        SELECT id
        FROM library_tracks
        WHERE path = %s
           OR path = %s
           OR path = %s
           OR navidrome_id = %s
           OR (%s != '' AND path LIKE %s)
        ORDER BY CASE
            WHEN path = %s THEN 0
            WHEN path = %s THEN 1
            WHEN path = %s THEN 2
            ELSE 3
        END
        LIMIT 1
        """,
        (
            track_path,
            absolute_candidate,
            music_candidate,
            track_path,
            suffix_candidate,
            suffix_candidate,
            track_path,
            absolute_candidate,
            music_candidate,
        ),
    )
    row = cur.fetchone()
    return row["id"] if row else None


# ── Follows ──────────────────────────────────────────────────

def follow_artist(user_id: int, artist_name: str) -> bool:
    """Follow an artist. Returns True if newly followed."""
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO user_follows (user_id, artist_name, created_at) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
            (user_id, artist_name, now))
        return cur.rowcount > 0


def unfollow_artist(user_id: int, artist_name: str) -> bool:
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM user_follows WHERE user_id = %s AND artist_name = %s", (user_id, artist_name))
        return cur.rowcount > 0


def get_followed_artists(user_id: int) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT uf.artist_name, uf.created_at, la.album_count, la.track_count, la.has_photo
            FROM user_follows uf
            LEFT JOIN library_artists la ON la.name = uf.artist_name
            WHERE uf.user_id = %s
            ORDER BY uf.created_at DESC
        """, (user_id,))
        return [dict(r) for r in cur.fetchall()]


def is_following(user_id: int, artist_name: str) -> bool:
    with get_db_ctx() as cur:
        cur.execute("SELECT 1 FROM user_follows WHERE user_id = %s AND artist_name = %s", (user_id, artist_name))
        return cur.fetchone() is not None


# ── Saved Albums ─────────────────────────────────────────────

def save_album(user_id: int, album_id: int) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO user_saved_albums (user_id, album_id, created_at) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
            (user_id, album_id, now))
        return cur.rowcount > 0


def unsave_album(user_id: int, album_id: int) -> bool:
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM user_saved_albums WHERE user_id = %s AND album_id = %s", (user_id, album_id))
        return cur.rowcount > 0


def get_saved_albums(user_id: int) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT usa.created_at AS saved_at, la.id, la.artist, la.name, la.year, la.has_cover, la.track_count, la.total_duration
            FROM user_saved_albums usa
            JOIN library_albums la ON la.id = usa.album_id
            WHERE usa.user_id = %s
            ORDER BY usa.created_at DESC
        """, (user_id,))
        return [dict(r) for r in cur.fetchall()]


def is_album_saved(user_id: int, album_id: int) -> bool:
    with get_db_ctx() as cur:
        cur.execute("SELECT 1 FROM user_saved_albums WHERE user_id = %s AND album_id = %s", (user_id, album_id))
        return cur.fetchone() is not None


# ── Liked Tracks ─────────────────────────────────────────────

def like_track(user_id: int, track_id: int | None = None, track_path: str | None = None) -> bool | None:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        resolved_track_id = _resolve_track_id(cur, track_id=track_id, track_path=track_path)
        if not resolved_track_id:
            return None
        cur.execute(
            "INSERT INTO user_liked_tracks (user_id, track_id, created_at) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
            (user_id, resolved_track_id, now))
        return cur.rowcount > 0


def unlike_track(user_id: int, track_id: int | None = None, track_path: str | None = None) -> bool:
    with get_db_ctx() as cur:
        resolved_track_id = _resolve_track_id(cur, track_id=track_id, track_path=track_path)
        if not resolved_track_id:
            return False
        cur.execute(
            "DELETE FROM user_liked_tracks WHERE user_id = %s AND track_id = %s",
            (user_id, resolved_track_id),
        )
        return cur.rowcount > 0


def get_liked_tracks(user_id: int, limit: int = 100) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT
                ult.track_id,
                ult.created_at AS liked_at,
                lt.path,
                lt.title,
                lt.artist,
                lt.album,
                lt.duration,
                lt.navidrome_id
            FROM user_liked_tracks ult
            JOIN library_tracks lt ON lt.id = ult.track_id
            WHERE ult.user_id = %s
            ORDER BY ult.created_at DESC
            LIMIT %s
        """, (user_id, limit))
        rows = []
        for row in cur.fetchall():
            item = dict(row)
            item["relative_path"] = _relative_track_path(item.get("path") or "")
            rows.append(item)
        return rows


def is_track_liked(user_id: int, track_id: int | None = None, track_path: str | None = None) -> bool:
    with get_db_ctx() as cur:
        resolved_track_id = _resolve_track_id(cur, track_id=track_id, track_path=track_path)
        if not resolved_track_id:
            return False
        cur.execute("SELECT 1 FROM user_liked_tracks WHERE user_id = %s AND track_id = %s", (user_id, resolved_track_id))
        return cur.fetchone() is not None


# ── Play History ─────────────────────────────────────────────

def record_play(
    user_id: int,
    track_path: str = "",
    title: str = "",
    artist: str = "",
    album: str = "",
    track_id: int | None = None,
):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        resolved_track_id = _resolve_track_id(cur, track_id=track_id, track_path=track_path)
        cur.execute(
            """
            INSERT INTO play_history (user_id, track_id, track_path, title, artist, album, played_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (user_id, resolved_track_id, track_path, title, artist, album, now),
        )


def record_play_event(
    user_id: int,
    *,
    track_id: int | None = None,
    track_path: str | None = None,
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
    with get_db_ctx() as cur:
        resolved_track_id = _resolve_track_id(cur, track_id=track_id, track_path=track_path)
        cur.execute(
            """
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
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            RETURNING id
            """,
            (
                user_id,
                resolved_track_id,
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
                created_at,
            ),
        )
        event_id = cur.fetchone()["id"]
        _recompute_user_listening_aggregates(cur, user_id)
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
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")


def _recompute_user_listening_aggregates(cur, user_id: int):
    _recompute_user_daily_listening(cur, user_id)
    for window, days in _STATS_WINDOWS.items():
        cutoff = _window_cutoff(days)
        _recompute_user_track_stats(cur, user_id, window, cutoff)
        _recompute_user_artist_stats(cur, user_id, window, cutoff)
        _recompute_user_album_stats(cur, user_id, window, cutoff)
        _recompute_user_genre_stats(cur, user_id, window, cutoff)


def _recompute_user_daily_listening(cur, user_id: int):
    cur.execute("DELETE FROM user_daily_listening WHERE user_id = %s", (user_id,))
    cur.execute(
        """
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
            substring(ended_at, 1, 10) AS day,
            COUNT(*)::INTEGER AS play_count,
            SUM(CASE WHEN was_completed THEN 1 ELSE 0 END)::INTEGER AS complete_play_count,
            SUM(CASE WHEN was_skipped THEN 1 ELSE 0 END)::INTEGER AS skip_count,
            COALESCE(SUM(played_seconds), 0) / 60.0 AS minutes_listened,
            COUNT(DISTINCT COALESCE(track_id::text, NULLIF(track_path, ''), 'unknown-track'))::INTEGER AS unique_tracks,
            COUNT(DISTINCT NULLIF(artist, ''))::INTEGER AS unique_artists,
            COUNT(DISTINCT NULLIF(CONCAT(COALESCE(artist, ''), '||', COALESCE(album, '')), '||'))::INTEGER AS unique_albums
        FROM user_play_events
        WHERE user_id = %s
        GROUP BY user_id, substring(ended_at, 1, 10)
        """,
        (user_id,),
    )


def _window_filter_sql(cutoff: str | None) -> tuple[str, tuple]:
    if cutoff is None:
        return "upe.user_id = %s", ()
    return "upe.user_id = %s AND upe.ended_at >= %s", (cutoff,)


def _recompute_user_track_stats(cur, user_id: int, window: str, cutoff: str | None):
    cur.execute("DELETE FROM user_track_stats WHERE user_id = %s AND window = %s", (user_id, window))
    where_sql, extra_params = _window_filter_sql(cutoff)
    cur.execute(
        f"""
        INSERT INTO user_track_stats (
            user_id,
            window,
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
            %s,
            %s,
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
        """,
        (user_id, window, user_id, *extra_params),
    )


def _recompute_user_artist_stats(cur, user_id: int, window: str, cutoff: str | None):
    cur.execute("DELETE FROM user_artist_stats WHERE user_id = %s AND window = %s", (user_id, window))
    where_sql, extra_params = _window_filter_sql(cutoff)
    cur.execute(
        f"""
        INSERT INTO user_artist_stats (
            user_id,
            window,
            artist_name,
            play_count,
            complete_play_count,
            minutes_listened,
            first_played_at,
            last_played_at
        )
        SELECT
            %s,
            %s,
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
        """,
        (user_id, window, user_id, *extra_params),
    )


def _recompute_user_album_stats(cur, user_id: int, window: str, cutoff: str | None):
    cur.execute("DELETE FROM user_album_stats WHERE user_id = %s AND window = %s", (user_id, window))
    where_sql, extra_params = _window_filter_sql(cutoff)
    cur.execute(
        f"""
        INSERT INTO user_album_stats (
            user_id,
            window,
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
            %s,
            %s,
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
        """,
        (user_id, window, user_id, *extra_params),
    )


def _recompute_user_genre_stats(cur, user_id: int, window: str, cutoff: str | None):
    cur.execute("DELETE FROM user_genre_stats WHERE user_id = %s AND window = %s", (user_id, window))
    where_sql, extra_params = _window_filter_sql(cutoff)
    cur.execute(
        f"""
        INSERT INTO user_genre_stats (
            user_id,
            window,
            genre_name,
            play_count,
            complete_play_count,
            minutes_listened,
            first_played_at,
            last_played_at
        )
        SELECT
            %s,
            %s,
            lt.genre AS genre_name,
            COUNT(*)::INTEGER AS play_count,
            SUM(CASE WHEN upe.was_completed THEN 1 ELSE 0 END)::INTEGER AS complete_play_count,
            COALESCE(SUM(upe.played_seconds), 0) / 60.0 AS minutes_listened,
            MIN(upe.started_at) AS first_played_at,
            MAX(upe.ended_at) AS last_played_at
        FROM user_play_events upe
        JOIN library_tracks lt ON lt.id = upe.track_id
        WHERE {where_sql}
          AND COALESCE(lt.genre, '') != ''
        GROUP BY lt.genre
        """,
        (user_id, window, user_id, *extra_params),
    )


def get_play_history(user_id: int, limit: int = 50) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT
                ph.track_id,
                COALESCE(lt.path, ph.track_path) AS track_path,
                COALESCE(lt.title, ph.title) AS title,
                COALESCE(lt.artist, ph.artist) AS artist,
                COALESCE(lt.album, ph.album) AS album,
                ph.played_at
            FROM play_history
            LEFT JOIN library_tracks lt ON lt.id = ph.track_id
            WHERE ph.user_id = %s
            ORDER BY ph.played_at DESC
            LIMIT %s
        """, (user_id, limit))
        rows = []
        for row in cur.fetchall():
            item = dict(row)
            item["relative_path"] = _relative_track_path(item.get("track_path") or "")
            rows.append(item)
        return rows


def get_play_stats(user_id: int) -> dict:
    """Get listening stats for a user."""
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT COALESCE(SUM(play_count), 0) AS total_plays FROM user_daily_listening WHERE user_id = %s",
            (user_id,),
        )
        total = cur.fetchone()["total_plays"]
        cur.execute(
            """
            SELECT artist_name AS artist, play_count AS plays
            FROM user_artist_stats
            WHERE user_id = %s AND window = 'all_time'
            ORDER BY play_count DESC, minutes_listened DESC, artist_name ASC
            LIMIT 10
            """,
            (user_id,),
        )
        top_artists = [dict(r) for r in cur.fetchall()]

        if not total and not top_artists:
            cur.execute("SELECT COUNT(*) AS total_plays FROM play_history WHERE user_id = %s", (user_id,))
            total = cur.fetchone()["total_plays"]
            cur.execute("""
                SELECT artist, COUNT(*) AS plays FROM play_history
                WHERE user_id = %s GROUP BY artist ORDER BY plays DESC LIMIT 10
            """, (user_id,))
            top_artists = [dict(r) for r in cur.fetchall()]

    return {"total_plays": total, "top_artists": top_artists}


def get_stats_overview(user_id: int, window: str = "30d") -> dict:
    normalized = _normalize_stats_window(window)
    day_cutoff = _window_day_cutoff(normalized)
    with get_db_ctx() as cur:
        if day_cutoff is None:
            cur.execute(
                """
                SELECT
                    COALESCE(SUM(play_count), 0) AS play_count,
                    COALESCE(SUM(complete_play_count), 0) AS complete_play_count,
                    COALESCE(SUM(skip_count), 0) AS skip_count,
                    COALESCE(SUM(minutes_listened), 0) AS minutes_listened,
                    COUNT(*)::INTEGER AS active_days
                FROM user_daily_listening
                WHERE user_id = %s
                """,
                (user_id,),
            )
        else:
            cur.execute(
                """
                SELECT
                    COALESCE(SUM(play_count), 0) AS play_count,
                    COALESCE(SUM(complete_play_count), 0) AS complete_play_count,
                    COALESCE(SUM(skip_count), 0) AS skip_count,
                    COALESCE(SUM(minutes_listened), 0) AS minutes_listened,
                    COUNT(*)::INTEGER AS active_days
                FROM user_daily_listening
                WHERE user_id = %s AND day >= %s
                """,
                (user_id, day_cutoff),
            )
        overview = dict(cur.fetchone() or {})

        cur.execute(
            """
            SELECT artist_name, play_count, minutes_listened
            FROM user_artist_stats
            WHERE user_id = %s AND window = %s
            ORDER BY play_count DESC, minutes_listened DESC, artist_name ASC
            LIMIT 1
            """,
            (user_id, normalized),
        )
        top_artist = cur.fetchone()

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
    with get_db_ctx() as cur:
        if day_cutoff is None:
            cur.execute(
                """
                SELECT day, play_count, complete_play_count, skip_count, minutes_listened
                FROM user_daily_listening
                WHERE user_id = %s
                ORDER BY day ASC
                """,
                (user_id,),
            )
        else:
            cur.execute(
                """
                SELECT day, play_count, complete_play_count, skip_count, minutes_listened
                FROM user_daily_listening
                WHERE user_id = %s AND day >= %s
                ORDER BY day ASC
                """,
                (user_id, day_cutoff),
            )
        rows = [dict(row) for row in cur.fetchall()]
    return {"window": normalized, "points": rows}


def get_top_tracks(user_id: int, window: str = "30d", limit: int = 20) -> list[dict]:
    normalized = _normalize_stats_window(window)
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT
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
            FROM user_track_stats
            WHERE user_id = %s AND window = %s
            ORDER BY play_count DESC, minutes_listened DESC, last_played_at DESC
            LIMIT %s
            """,
            (user_id, normalized, limit),
        )
        return [dict(row) for row in cur.fetchall()]


def get_top_artists(user_id: int, window: str = "30d", limit: int = 20) -> list[dict]:
    normalized = _normalize_stats_window(window)
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT
                artist_name,
                play_count,
                complete_play_count,
                minutes_listened,
                first_played_at,
                last_played_at
            FROM user_artist_stats
            WHERE user_id = %s AND window = %s
            ORDER BY play_count DESC, minutes_listened DESC, last_played_at DESC
            LIMIT %s
            """,
            (user_id, normalized, limit),
        )
        return [dict(row) for row in cur.fetchall()]


def get_top_albums(user_id: int, window: str = "30d", limit: int = 20) -> list[dict]:
    normalized = _normalize_stats_window(window)
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT
                artist,
                album,
                play_count,
                complete_play_count,
                minutes_listened,
                first_played_at,
                last_played_at
            FROM user_album_stats
            WHERE user_id = %s AND window = %s
            ORDER BY play_count DESC, minutes_listened DESC, last_played_at DESC
            LIMIT %s
            """,
            (user_id, normalized, limit),
        )
        return [dict(row) for row in cur.fetchall()]


def get_top_genres(user_id: int, window: str = "30d", limit: int = 20) -> list[dict]:
    normalized = _normalize_stats_window(window)
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT
                genre_name,
                play_count,
                complete_play_count,
                minutes_listened,
                first_played_at,
                last_played_at
            FROM user_genre_stats
            WHERE user_id = %s AND window = %s
            ORDER BY play_count DESC, minutes_listened DESC, last_played_at DESC
            LIMIT %s
            """,
            (user_id, normalized, limit),
        )
        return [dict(row) for row in cur.fetchall()]


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
    with get_db_ctx() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM user_follows WHERE user_id = %s", (user_id,))
        follows = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) AS c FROM user_saved_albums WHERE user_id = %s", (user_id,))
        albums = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) AS c FROM user_liked_tracks WHERE user_id = %s", (user_id,))
        likes = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) AS c FROM playlists WHERE user_id = %s", (user_id,))
        playlists = cur.fetchone()["c"]
    return {"followed_artists": follows, "saved_albums": albums, "liked_tracks": likes, "playlists": playlists}
