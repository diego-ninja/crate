import pytest

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _seed_genre_playlist_fixture(pg_db):
    artist_name = "Genre Weight Band"
    pg_db.upsert_artist(
        {
            "name": artist_name,
            "album_count": 2,
            "track_count": 2,
            "total_size": 0,
            "formats": ["flac"],
        }
    )

    album_high_id = pg_db.upsert_album(
        {
            "artist": artist_name,
            "name": "Heavy Record",
            "path": "/music/genre-weight-band/heavy-record",
            "track_count": 1,
            "total_size": 0,
            "formats": ["flac"],
            "year": "2001",
        }
    )
    album_low_id = pg_db.upsert_album(
        {
            "artist": artist_name,
            "name": "Sideways Record",
            "path": "/music/genre-weight-band/sideways-record",
            "track_count": 1,
            "total_size": 0,
            "formats": ["flac"],
            "year": "2003",
        }
    )

    high_track_path = "/music/genre-weight-band/heavy-record/01-zulu-anthems.flac"
    low_track_path = "/music/genre-weight-band/sideways-record/01-alpha-whisper.flac"

    pg_db.upsert_track(
        {
            "album_id": album_high_id,
            "artist": artist_name,
            "album": "Heavy Record",
            "filename": "01-zulu-anthems.flac",
            "title": "Zulu Anthems",
            "track_number": 1,
            "format": "flac",
            "duration": 180,
            "size": 123,
            "path": high_track_path,
            "popularity_score": 0.2,
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_low_id,
            "artist": artist_name,
            "album": "Sideways Record",
            "filename": "01-alpha-whisper.flac",
            "title": "Alpha Whisper",
            "track_number": 1,
            "format": "flac",
            "duration": 180,
            "size": 123,
            "path": low_track_path,
            "popularity_score": 0.1,
        }
    )

    pg_db.set_artist_genres(
        artist_name,
        [
            ("metalcore", 0.35, "enrichment"),
            ("hardcore", 1.0, "enrichment"),
        ],
    )
    pg_db.set_album_genres(
        album_high_id,
        [
            ("metalcore", 1.0, "tags"),
            ("hardcore", 0.4, "tags"),
        ],
    )
    pg_db.set_album_genres(
        album_low_id,
        [
            ("hardcore", 1.0, "tags"),
        ],
    )

    high_track_id = pg_db.get_library_track_by_path(high_track_path)["id"]
    low_track_id = pg_db.get_library_track_by_path(low_track_path)["id"]

    return {
        "high_track_id": high_track_id,
        "low_track_id": low_track_id,
    }


def test_execute_smart_rules_prefers_higher_genre_weight(pg_db):
    from crate.db.playlists import execute_smart_rules

    seeded = _seed_genre_playlist_fixture(pg_db)

    results = execute_smart_rules(
        {
            "match": "all",
            "rules": [{"field": "genre", "op": "contains", "value": "metalcore"}],
            "limit": 10,
            "sort": "title",
        }
    )

    assert [track["id"] for track in results[:2]] == [
        seeded["high_track_id"],
        seeded["low_track_id"],
    ]


def test_generate_by_genre_prefers_direct_album_signal(pg_db):
    from crate.db.playlists import generate_by_genre

    seeded = _seed_genre_playlist_fixture(pg_db)

    results = generate_by_genre("metalcore", limit=10)

    assert results[:2] == [seeded["high_track_id"], seeded["low_track_id"]]
