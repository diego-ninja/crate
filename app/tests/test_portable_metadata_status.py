import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_portable_metadata_status_counts_track_and_fallback_lyrics(pg_db):
    from crate.db.cache_store import delete_cache
    from crate.db.repositories.portable_metadata import get_portable_metadata_status
    from crate.db.tx import transaction_scope

    cache_key = "analysis:portable_metadata_status:v2"
    delete_cache(cache_key)
    before = get_portable_metadata_status()

    pg_db.upsert_artist({"name": "Portable Status Artist"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Portable Status Artist",
            "name": "Portable Status Album",
            "path": "/music/Portable Status Artist/Portable Status Album",
            "track_count": 3,
        }
    )
    for number in range(1, 4):
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Portable Status Artist",
                "album": "Portable Status Album",
                "filename": f"0{number} track.flac",
                "title": f"Track {number}",
                "path": f"/music/Portable Status Artist/Portable Status Album/0{number} track.flac",
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )

    with transaction_scope() as session:
        tracks = (
            session.execute(
                text(
                    """
                SELECT id, title
                FROM library_tracks
                WHERE album_id = :album_id
                ORDER BY id
                """
                ),
                {"album_id": album_id},
            )
            .mappings()
            .all()
        )
        session.execute(
            text(
                """
                INSERT INTO track_lyrics
                    (provider, artist_key, title_key, artist, title, track_id, found, plain_lyrics)
                VALUES
                    ('lrclib', 'portable status artist', 'track 1', 'Portable Status Artist', 'Track 1', :track_id, TRUE, 'lyrics'),
                    ('lrclib', 'portable status artist', 'track 2', 'Portable Status Artist', 'Track 2', NULL, TRUE, 'lyrics'),
                    ('lrclib', 'portable status artist', 'track 3', 'Portable Status Artist', 'Track 3', :missing_track_id, FALSE, NULL)
                """
            ),
            {
                "track_id": tracks[0]["id"],
                "missing_track_id": tracks[2]["id"],
            },
        )

    delete_cache(cache_key)
    after = get_portable_metadata_status()

    assert after["lyrics_cached"] - before["lyrics_cached"] == 3
    assert after["lyrics_found"] - before["lyrics_found"] == 2
    assert after["lyrics_missing"] - before["lyrics_missing"] == 1
