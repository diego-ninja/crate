"""Tests for consolidated track popularity scoring."""

from unittest.mock import patch

import pytest

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _seed_artist_album_and_tracks(pg_db, artist_name: str):
    pg_db.upsert_artist(
        {
            "name": artist_name,
            "album_count": 2,
            "track_count": 3,
            "total_size": 0,
            "formats": ["flac"],
        }
    )

    album_one_id = pg_db.upsert_album(
        {
            "artist": artist_name,
            "name": "Alpha",
            "path": f"/music/{artist_name.lower().replace(' ', '-')}/alpha",
            "track_count": 2,
            "total_size": 0,
            "formats": ["flac"],
            "year": "2020",
        }
    )
    album_two_id = pg_db.upsert_album(
        {
            "artist": artist_name,
            "name": "Beta",
            "path": f"/music/{artist_name.lower().replace(' ', '-')}/beta",
            "track_count": 1,
            "total_size": 0,
            "formats": ["flac"],
            "year": "2021",
        }
    )

    pg_db.upsert_track(
        {
            "album_id": album_one_id,
            "artist": artist_name,
            "album": "Alpha",
            "filename": "01-big-song.flac",
            "title": "Big Song",
            "track_number": 1,
            "format": "flac",
            "duration": 180,
            "size": 123,
            "path": f"/music/{artist_name.lower().replace(' ', '-')}/alpha/01-big-song.flac",
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_one_id,
            "artist": artist_name,
            "album": "Alpha",
            "filename": "02-deep-cut.flac",
            "title": "Deep Cut",
            "track_number": 2,
            "format": "flac",
            "duration": 200,
            "size": 123,
            "path": f"/music/{artist_name.lower().replace(' ', '-')}/alpha/02-deep-cut.flac",
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_two_id,
            "artist": artist_name,
            "album": "Beta",
            "filename": "01-hidden-gem.flac",
            "title": "Hidden Gem",
            "track_number": 1,
            "format": "flac",
            "duration": 220,
            "size": 123,
            "path": f"/music/{artist_name.lower().replace(' ', '-')}/beta/01-hidden-gem.flac",
        }
    )

    return {
        "album_one_id": album_one_id,
        "album_two_id": album_two_id,
        "big_song_path": f"/music/{artist_name.lower().replace(' ', '-')}/alpha/01-big-song.flac",
        "deep_cut_path": f"/music/{artist_name.lower().replace(' ', '-')}/alpha/02-deep-cut.flac",
        "hidden_gem_path": f"/music/{artist_name.lower().replace(' ', '-')}/beta/01-hidden-gem.flac",
    }


def test_refresh_artist_track_popularity_signals_matches_lastfm_and_spotify(pg_db):
    from crate.popularity import refresh_artist_track_popularity_signals

    seeded = _seed_artist_album_and_tracks(pg_db, "Signal Artist")
    pg_db.update_artist_enrichment(
        "Signal Artist",
        {
            "listeners": 120000,
            "lastfm_playcount": 450000,
            "spotify_id": "spotify-signal-artist",
            "spotify_popularity": 77,
            "spotify_followers": 200000,
        },
    )

    with patch(
        "crate.popularity.get_lastfm_top_tracks",
        return_value=[{"title": "Big Song", "listeners": 9000, "playcount": 50000}],
    ), patch(
        "crate.popularity.get_spotify_top_tracks",
        return_value=[{"name": "Big Song", "popularity": 88}],
    ):
        result = refresh_artist_track_popularity_signals("Signal Artist")

    assert result["lastfm_matches"] == 1
    assert result["spotify_matches"] == 1

    big_song = pg_db.get_library_track_by_path(seeded["big_song_path"])
    deep_cut = pg_db.get_library_track_by_path(seeded["deep_cut_path"])

    assert big_song["lastfm_top_rank"] == 1
    assert big_song["lastfm_listeners"] == 9000
    assert big_song["lastfm_playcount"] == 50000
    assert big_song["spotify_track_popularity"] == 88
    assert big_song["spotify_top_rank"] == 1
    assert deep_cut["lastfm_top_rank"] is None
    assert deep_cut["spotify_track_popularity"] is None


def test_recompute_track_popularity_scores_backfills_all_tracks(pg_db):
    from crate.db.jobs.popularity import bulk_update_lastfm_top_track_signals, update_album_lastfm
    from crate.popularity import recompute_track_popularity_scores

    seeded = _seed_artist_album_and_tracks(pg_db, "Score Artist")
    pg_db.update_artist_enrichment(
        "Score Artist",
        {
            "listeners": 240000,
            "lastfm_playcount": 900000,
            "spotify_popularity": 70,
            "spotify_followers": 350000,
        },
    )
    update_album_lastfm(seeded["album_one_id"], listeners=120000, playcount=400000)
    update_album_lastfm(seeded["album_two_id"], listeners=30000, playcount=70000)

    big_song = pg_db.get_library_track_by_path(seeded["big_song_path"])
    bulk_update_lastfm_top_track_signals(
        [
            {
                "id": big_song["id"],
                "lastfm_top_rank": 1,
                "lastfm_listeners": 15000,
                "lastfm_playcount": 80000,
            }
        ]
    )

    result = recompute_track_popularity_scores(["Score Artist"])

    assert result["tracks_scored"] == 3

    big_song = pg_db.get_library_track_by_path(seeded["big_song_path"])
    deep_cut = pg_db.get_library_track_by_path(seeded["deep_cut_path"])
    hidden_gem = pg_db.get_library_track_by_path(seeded["hidden_gem_path"])

    assert big_song["popularity_score"] > 0
    assert deep_cut["popularity_score"] > 0
    assert hidden_gem["popularity_score"] > 0

    assert big_song["popularity_score"] > deep_cut["popularity_score"] > hidden_gem["popularity_score"]
    assert big_song["popularity_confidence"] > deep_cut["popularity_confidence"] >= hidden_gem["popularity_confidence"]


def test_recompute_album_and_artist_popularity_scores_follow_track_signal(pg_db):
    from crate.db.jobs.popularity import bulk_update_lastfm_top_track_signals, update_album_lastfm
    from crate.popularity import (
        recompute_album_popularity_scores,
        recompute_artist_popularity_scores,
        recompute_track_popularity_scores,
    )

    seeded = _seed_artist_album_and_tracks(pg_db, "Catalog Artist")
    pg_db.update_artist_enrichment(
        "Catalog Artist",
        {
            "listeners": 500000,
            "lastfm_playcount": 2100000,
            "spotify_popularity": 81,
            "spotify_followers": 750000,
        },
    )
    update_album_lastfm(seeded["album_one_id"], listeners=180000, playcount=900000)
    update_album_lastfm(seeded["album_two_id"], listeners=25000, playcount=60000)

    big_song = pg_db.get_library_track_by_path(seeded["big_song_path"])
    bulk_update_lastfm_top_track_signals(
        [
            {
                "id": big_song["id"],
                "lastfm_top_rank": 1,
                "lastfm_listeners": 30000,
                "lastfm_playcount": 180000,
            }
        ]
    )

    recompute_track_popularity_scores(["Catalog Artist"])
    album_result = recompute_album_popularity_scores(["Catalog Artist"])
    artist_result = recompute_artist_popularity_scores(["Catalog Artist"])

    assert album_result["albums_scored"] == 2
    assert artist_result["artists_scored"] == 1

    alpha = pg_db.get_library_album_by_id(seeded["album_one_id"])
    beta = pg_db.get_library_album_by_id(seeded["album_two_id"])
    artist = pg_db.get_library_artist("Catalog Artist")

    assert alpha["popularity_score"] > 0
    assert beta["popularity_score"] > 0
    assert alpha["popularity_score"] > beta["popularity_score"]
    assert alpha["popularity"] > beta["popularity"]
    assert alpha["popularity_confidence"] >= beta["popularity_confidence"]

    assert artist["popularity_score"] > 0
    assert artist["popularity"] > 0
    assert artist["popularity_confidence"] > 0
