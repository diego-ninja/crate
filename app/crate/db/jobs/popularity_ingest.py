from sqlalchemy import text

from crate.db.tx import transaction_scope


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


__all__ = [
    "bulk_update_lastfm_top_track_signals",
    "bulk_update_spotify_track_signals",
    "get_albums_without_popularity",
    "get_artist_track_popularity_context",
    "get_tracks_without_popularity",
    "reset_track_popularity_signals",
    "update_album_lastfm",
    "update_track_lastfm",
]
