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
