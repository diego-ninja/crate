from sqlalchemy import text

from crate.db.tx import transaction_scope


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


__all__ = [
    "bulk_update_album_popularity_scores",
    "bulk_update_artist_popularity_scores",
    "bulk_update_track_popularity_scores",
    "normalize_popularity_scores",
]
