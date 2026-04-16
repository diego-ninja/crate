from crate.db.core import get_db_ctx


def get_last_analyzed_track() -> dict:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT title, artist, album, bpm, audio_key, energy, danceability,
                   mood_json IS NOT NULL as has_mood, updated_at
            FROM library_tracks
            WHERE analysis_state = 'done' AND bpm IS NOT NULL
            ORDER BY updated_at DESC LIMIT 1
        """)
        row = cur.fetchone()
    return dict(row) if row else {}


def get_last_bliss_track() -> dict:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT title, artist, album, updated_at
            FROM library_tracks
            WHERE bliss_state = 'done' AND bliss_vector IS NOT NULL
            ORDER BY updated_at DESC LIMIT 1
        """)
        row = cur.fetchone()
    return dict(row) if row else {}


def get_storage_v2_status() -> dict:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT
                COUNT(*) AS total_artists,
                COUNT(*) FILTER (WHERE storage_id IS NOT NULL AND folder_name = storage_id::text) AS migrated_artists
            FROM library_artists
        """)
        artist_stats = dict(cur.fetchone())

        cur.execute("""
            SELECT
                COUNT(*) AS total_albums,
                COUNT(*) FILTER (
                    WHERE storage_id IS NOT NULL
                    AND path LIKE '%%/' || storage_id::text
                ) AS migrated_albums
            FROM library_albums
        """)
        album_stats = dict(cur.fetchone())

        cur.execute("""
            SELECT
                COUNT(*) AS total_tracks,
                COUNT(*) FILTER (
                    WHERE storage_id IS NOT NULL
                    AND filename = storage_id::text || SUBSTRING(filename FROM '\\.[^.]+$')
                ) AS migrated_tracks
            FROM library_tracks
        """)
        track_stats = dict(cur.fetchone())

    return {**artist_stats, **album_stats, **track_stats}
