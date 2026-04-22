from crate.db.tx import transaction_scope
from sqlalchemy import text


def get_albums_without_popularity() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT id, artist, name, tag_album FROM library_albums WHERE lastfm_listeners IS NULL")
        ).mappings().all()
    return [dict(r) for r in rows]


def update_album_lastfm(album_id: int, listeners: int, playcount: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET lastfm_listeners = :listeners, lastfm_playcount = :playcount WHERE id = :id"),
            {"listeners": listeners, "playcount": playcount, "id": album_id},
        )


def get_tracks_without_popularity() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT t.id, t.artist, t.title, t.album
            FROM library_tracks t
            WHERE t.title IS NOT NULL AND t.title != '' AND t.lastfm_listeners IS NULL
        """)).mappings().all()
    return [dict(r) for r in rows]


def update_track_lastfm(track_id: int, listeners: int, playcount: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_tracks SET lastfm_listeners = :listeners, lastfm_playcount = :playcount WHERE id = :id"),
            {"listeners": listeners, "playcount": playcount, "id": track_id},
        )


def reset_track_popularity_signals(artist_name: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("""
                UPDATE library_tracks
                SET lastfm_top_rank = NULL,
                    spotify_track_popularity = NULL,
                    spotify_top_rank = NULL
                WHERE album_id IN (
                    SELECT id FROM library_albums WHERE LOWER(artist) = LOWER(:artist_name)
                )
            """),
            {"artist_name": artist_name},
        )


def get_artist_track_popularity_context(artist_name: str) -> dict:
    with transaction_scope() as session:
        artist = session.execute(
            text("""
                SELECT
                    name,
                    listeners,
                    lastfm_playcount,
                    spotify_id,
                    spotify_popularity,
                    spotify_followers
                FROM library_artists
                WHERE LOWER(name) = LOWER(:artist_name)
                ORDER BY id NULLS LAST
                LIMIT 1
            """),
            {"artist_name": artist_name},
        ).mappings().first()

        tracks = session.execute(
            text("""
                SELECT
                    t.id,
                    t.title,
                    t.lastfm_listeners,
                    t.lastfm_playcount,
                    t.lastfm_top_rank,
                    t.spotify_track_popularity,
                    t.spotify_top_rank,
                    t.track_number,
                    t.disc_number,
                    a.id AS album_id,
                    a.name AS album_name,
                    a.lastfm_listeners AS album_lastfm_listeners,
                    a.lastfm_playcount AS album_lastfm_playcount
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                WHERE LOWER(a.artist) = LOWER(:artist_name)
                ORDER BY a.year NULLS LAST, a.name, t.disc_number NULLS LAST, t.track_number NULLS LAST, t.id
            """),
            {"artist_name": artist_name},
        ).mappings().all()

    return {
        "artist": dict(artist) if artist else None,
        "tracks": [dict(row) for row in tracks],
    }


def bulk_update_lastfm_top_track_signals(updates: list[dict]) -> None:
    if not updates:
        return
    with transaction_scope() as session:
        session.execute(
            text("""
                UPDATE library_tracks
                SET lastfm_top_rank = :lastfm_top_rank,
                    lastfm_listeners = CASE
                        WHEN :lastfm_listeners IS NULL OR :lastfm_listeners <= 0
                            THEN lastfm_listeners
                        WHEN lastfm_listeners IS NULL
                            THEN :lastfm_listeners
                        ELSE GREATEST(lastfm_listeners, :lastfm_listeners)
                    END,
                    lastfm_playcount = CASE
                        WHEN :lastfm_playcount IS NULL OR :lastfm_playcount <= 0
                            THEN lastfm_playcount
                        WHEN lastfm_playcount IS NULL
                            THEN :lastfm_playcount
                        ELSE GREATEST(lastfm_playcount, :lastfm_playcount)
                    END
                WHERE id = :id
            """),
            updates,
        )


def bulk_update_spotify_track_signals(updates: list[dict]) -> None:
    if not updates:
        return
    with transaction_scope() as session:
        session.execute(
            text("""
                UPDATE library_tracks
                SET spotify_track_popularity = :spotify_track_popularity,
                    spotify_top_rank = :spotify_top_rank
                WHERE id = :id
            """),
            updates,
        )


def get_popularity_scales() -> dict:
    with transaction_scope() as session:
        row = session.execute(
            text("""
                SELECT
                    COALESCE(
                        (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY lastfm_playcount)
                         FROM library_tracks WHERE lastfm_playcount IS NOT NULL AND lastfm_playcount > 0),
                        1
                    ) AS track_playcount_p95,
                    COALESCE(
                        (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY lastfm_listeners)
                         FROM library_tracks WHERE lastfm_listeners IS NOT NULL AND lastfm_listeners > 0),
                        1
                    ) AS track_listeners_p95,
                    COALESCE(
                        (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY lastfm_playcount)
                         FROM library_albums WHERE lastfm_playcount IS NOT NULL AND lastfm_playcount > 0),
                        1
                    ) AS album_playcount_p95,
                    COALESCE(
                        (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY lastfm_listeners)
                         FROM library_albums WHERE lastfm_listeners IS NOT NULL AND lastfm_listeners > 0),
                        1
                    ) AS album_listeners_p95,
                    COALESCE(
                        (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY lastfm_playcount)
                         FROM library_artists WHERE lastfm_playcount IS NOT NULL AND lastfm_playcount > 0),
                        1
                    ) AS artist_playcount_p95,
                    COALESCE(
                        (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY listeners)
                         FROM library_artists WHERE listeners IS NOT NULL AND listeners > 0),
                        1
                    ) AS artist_listeners_p95,
                    COALESCE(
                        (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY spotify_followers)
                         FROM library_artists WHERE spotify_followers IS NOT NULL AND spotify_followers > 0),
                        1
                    ) AS artist_followers_p95
            """)
        ).mappings().first()
    return dict(row or {})


def list_tracks_for_popularity_scoring(artist_names: list[str] | None = None) -> list[dict]:
    params: dict[str, object] = {}
    where = ""
    if artist_names:
        params["artist_names"] = [name.lower() for name in artist_names]
        where = "WHERE LOWER(a.artist) = ANY(:artist_names)"

    with transaction_scope() as session:
        rows = session.execute(
            text(f"""
                SELECT
                    t.id,
                    t.lastfm_listeners,
                    t.lastfm_playcount,
                    t.lastfm_top_rank,
                    t.spotify_track_popularity,
                    t.spotify_top_rank,
                    a.lastfm_listeners AS album_lastfm_listeners,
                    a.lastfm_playcount AS album_lastfm_playcount,
                    ar.listeners AS artist_lastfm_listeners,
                    ar.lastfm_playcount AS artist_lastfm_playcount,
                    ar.spotify_popularity AS artist_spotify_popularity,
                    ar.spotify_followers AS artist_spotify_followers
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                LEFT JOIN library_artists ar ON LOWER(ar.name) = LOWER(a.artist)
                {where}
            """),
            params,
        ).mappings().all()
    return [dict(row) for row in rows]


def list_albums_for_popularity_scoring(artist_names: list[str] | None = None) -> list[dict]:
    params: dict[str, object] = {}
    where = ""
    if artist_names:
        params["artist_names"] = [name.lower() for name in artist_names]
        where = "WHERE LOWER(a.artist) = ANY(:artist_names)"

    with transaction_scope() as session:
        rows = session.execute(
            text(f"""
                SELECT
                    a.id,
                    a.lastfm_listeners,
                    a.lastfm_playcount,
                    ar.listeners AS artist_lastfm_listeners,
                    ar.lastfm_playcount AS artist_lastfm_playcount,
                    ar.spotify_popularity AS artist_spotify_popularity,
                    ar.spotify_followers AS artist_spotify_followers,
                    COUNT(t.id) FILTER (WHERE t.popularity_score IS NOT NULL) AS scored_tracks,
                    MAX(t.popularity_score) AS max_track_popularity_score,
                    AVG(t.popularity_score) AS avg_track_popularity_score
                FROM library_albums a
                LEFT JOIN library_artists ar ON LOWER(ar.name) = LOWER(a.artist)
                LEFT JOIN library_tracks t ON t.album_id = a.id
                {where}
                GROUP BY
                    a.id,
                    a.lastfm_listeners,
                    a.lastfm_playcount,
                    ar.listeners,
                    ar.lastfm_playcount,
                    ar.spotify_popularity,
                    ar.spotify_followers
            """),
            params,
        ).mappings().all()
    return [dict(row) for row in rows]


def list_artists_for_popularity_scoring(artist_names: list[str] | None = None) -> list[dict]:
    params: dict[str, object] = {}
    where = ""
    if artist_names:
        params["artist_names"] = [name.lower() for name in artist_names]
        where = "WHERE LOWER(ar.name) = ANY(:artist_names)"

    with transaction_scope() as session:
        rows = session.execute(
            text(f"""
                SELECT
                    ar.id,
                    ar.listeners AS artist_lastfm_listeners,
                    ar.lastfm_playcount AS artist_lastfm_playcount,
                    ar.spotify_popularity AS artist_spotify_popularity,
                    ar.spotify_followers AS artist_spotify_followers,
                    COALESCE(album_stats.scored_albums, 0) AS scored_albums,
                    COALESCE(track_stats.scored_tracks, 0) AS scored_tracks,
                    album_stats.max_album_popularity_score,
                    album_stats.avg_album_popularity_score,
                    track_stats.max_track_popularity_score,
                    track_stats.avg_track_popularity_score
                FROM library_artists ar
                LEFT JOIN (
                    SELECT
                        LOWER(artist) AS artist_key,
                        COUNT(*) FILTER (WHERE popularity_score IS NOT NULL) AS scored_albums,
                        MAX(popularity_score) AS max_album_popularity_score,
                        AVG(popularity_score) AS avg_album_popularity_score
                    FROM library_albums
                    GROUP BY LOWER(artist)
                ) album_stats ON album_stats.artist_key = LOWER(ar.name)
                LEFT JOIN (
                    SELECT
                        LOWER(a.artist) AS artist_key,
                        COUNT(t.id) FILTER (WHERE t.popularity_score IS NOT NULL) AS scored_tracks,
                        MAX(t.popularity_score) AS max_track_popularity_score,
                        AVG(t.popularity_score) AS avg_track_popularity_score
                    FROM library_tracks t
                    JOIN library_albums a ON a.id = t.album_id
                    GROUP BY LOWER(a.artist)
                ) track_stats ON track_stats.artist_key = LOWER(ar.name)
                {where}
            """),
            params,
        ).mappings().all()
    return [dict(row) for row in rows]


def bulk_update_track_popularity_scores(updates: list[dict]) -> None:
    if not updates:
        return
    with transaction_scope() as session:
        session.execute(
            text("""
                UPDATE library_tracks
                SET popularity_score = :popularity_score,
                    popularity_confidence = :popularity_confidence,
                    popularity = :popularity
                WHERE id = :id
            """),
            updates,
        )


def bulk_update_album_popularity_scores(updates: list[dict]) -> None:
    if not updates:
        return
    with transaction_scope() as session:
        session.execute(
            text("""
                UPDATE library_albums
                SET popularity_score = :popularity_score,
                    popularity_confidence = :popularity_confidence,
                    popularity = :popularity
                WHERE id = :id
            """),
            updates,
        )


def bulk_update_artist_popularity_scores(updates: list[dict]) -> None:
    if not updates:
        return
    with transaction_scope() as session:
        session.execute(
            text("""
                UPDATE library_artists
                SET popularity_score = :popularity_score,
                    popularity_confidence = :popularity_confidence,
                    popularity = :popularity
                WHERE id = :id
            """),
            updates,
        )


def normalize_popularity_scores() -> None:
    with transaction_scope() as session:
        max_album = session.execute(
            text("SELECT MAX(lastfm_listeners) AS m FROM library_albums WHERE lastfm_listeners IS NOT NULL")
        ).mappings().first()["m"] or 1
        session.execute(
            text("UPDATE library_albums SET popularity = LEAST(100, GREATEST(1, (lastfm_listeners::float / :max_album * 100)::int)) "
                 "WHERE lastfm_listeners IS NOT NULL AND lastfm_listeners > 0"),
            {"max_album": max_album},
        )

        max_track = session.execute(
            text("SELECT MAX(lastfm_listeners) AS m FROM library_tracks WHERE lastfm_listeners IS NOT NULL")
        ).mappings().first()["m"] or 1
        session.execute(
            text("UPDATE library_tracks SET popularity = LEAST(100, GREATEST(1, (lastfm_listeners::float / :max_track * 100)::int)) "
                 "WHERE lastfm_listeners IS NOT NULL AND lastfm_listeners > 0"),
            {"max_track": max_track},
        )

        max_artist = session.execute(
            text("SELECT MAX(listeners) AS m FROM library_artists WHERE listeners IS NOT NULL")
        ).mappings().first()["m"] or 1
        session.execute(
            text("UPDATE library_artists SET popularity = LEAST(100, GREATEST(1, (listeners::float / :max_artist * 100)::int)) "
                 "WHERE listeners IS NOT NULL AND listeners > 0"),
            {"max_artist": max_artist},
        )
