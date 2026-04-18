from sqlalchemy import text

from crate.db.tx import transaction_scope


def get_last_analyzed_track() -> dict:
    with transaction_scope() as session:
        row = session.execute(text("""
            SELECT title, artist, album, bpm, audio_key, energy, danceability,
                   mood_json IS NOT NULL as has_mood, updated_at
            FROM library_tracks
            WHERE analysis_state = 'done' AND bpm IS NOT NULL
            ORDER BY updated_at DESC LIMIT 1
        """)).mappings().first()
    return dict(row) if row else {}


def get_last_bliss_track() -> dict:
    with transaction_scope() as session:
        row = session.execute(text("""
            SELECT title, artist, album, updated_at
            FROM library_tracks
            WHERE bliss_state = 'done' AND bliss_vector IS NOT NULL
            ORDER BY updated_at DESC LIMIT 1
        """)).mappings().first()
    return dict(row) if row else {}


def get_storage_v2_status() -> dict:
    with transaction_scope() as session:
        artist_stats = dict(session.execute(text("""
            SELECT
                COUNT(*) AS total_artists,
                COUNT(*) FILTER (WHERE storage_id IS NOT NULL AND folder_name = storage_id::text) AS migrated_artists
            FROM library_artists
        """)).mappings().first())

        album_stats = dict(session.execute(text("""
            SELECT
                COUNT(*) AS total_albums,
                COUNT(*) FILTER (
                    WHERE storage_id IS NOT NULL
                    AND path LIKE '%/' || storage_id::text
                ) AS migrated_albums
            FROM library_albums
        """)).mappings().first())

        track_stats = dict(session.execute(text("""
            SELECT
                COUNT(*) AS total_tracks,
                COUNT(*) FILTER (
                    WHERE storage_id IS NOT NULL
                    AND filename = storage_id::text || SUBSTRING(filename FROM '\\.[^.]+$')
                ) AS migrated_tracks
            FROM library_tracks
        """)).mappings().first())

    return {**artist_stats, **album_stats, **track_stats}
