from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.user_library_shared import normalize_stats_window
from crate.db.tx import read_scope


def get_top_tracks(user_id: int, window: str = "30d", limit: int = 20) -> list[dict]:
    normalized = normalize_stats_window(window)
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    uts.track_id,
                    COALESCE(lt.entity_uid::text, uts.track_entity_uid::text) AS track_entity_uid,
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
                LEFT JOIN library_tracks lt
                  ON lt.id = uts.track_id
                  OR (uts.track_id IS NULL AND uts.track_entity_uid IS NOT NULL AND lt.entity_uid = uts.track_entity_uid)
                LEFT JOIN library_albums alb_by_id ON alb_by_id.id = lt.album_id
                LEFT JOIN library_albums alb_by_name
                  ON alb_by_id.id IS NULL
                 AND alb_by_name.artist = COALESCE(lt.artist, uts.artist)
                 AND alb_by_name.name = COALESCE(lt.album, uts.album)
                LEFT JOIN library_artists art ON art.name = COALESCE(lt.artist, uts.artist)
                WHERE uts.user_id = :user_id AND uts.stat_window = :window
                ORDER BY uts.play_count DESC, uts.minutes_listened DESC, uts.last_played_at DESC
                LIMIT :lim
                """
            ),
            {"user_id": user_id, "window": normalized, "lim": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_top_artists(user_id: int, window: str = "30d", limit: int = 20) -> list[dict]:
    normalized = normalize_stats_window(window)
    with read_scope() as session:
        rows = session.execute(
            text(
                """
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
                """
            ),
            {"user_id": user_id, "window": normalized, "lim": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_top_albums(user_id: int, window: str = "30d", limit: int = 20) -> list[dict]:
    normalized = normalize_stats_window(window)
    with read_scope() as session:
        rows = session.execute(
            text(
                """
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
                """
            ),
            {"user_id": user_id, "window": normalized, "lim": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_top_genres(user_id: int, window: str = "30d", limit: int = 20) -> list[dict]:
    normalized = normalize_stats_window(window)
    with read_scope() as session:
        rows = session.execute(
            text(
                """
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
                """
            ),
            {"user_id": user_id, "window": normalized, "lim": limit},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_replay_mix(user_id: int, window: str = "30d", limit: int = 30) -> dict:
    normalized = normalize_stats_window(window)
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


__all__ = [
    "get_replay_mix",
    "get_top_albums",
    "get_top_artists",
    "get_top_genres",
    "get_top_tracks",
]
