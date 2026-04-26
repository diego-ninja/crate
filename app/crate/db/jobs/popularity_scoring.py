from sqlalchemy import text

from crate.db.tx import transaction_scope


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


__all__ = [
    "get_popularity_scales",
    "list_albums_for_popularity_scoring",
    "list_artists_for_popularity_scoring",
    "list_tracks_for_popularity_scoring",
]
