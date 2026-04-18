from __future__ import annotations

from unittest.mock import patch


def test_get_similar_from_db_uses_fallback_without_bliss_vector():
    from crate.bliss import get_similar_from_db

    source = {
        "track_id": 1,
        "path": "/music/Converge/Jane Doe/01 - Concubine.flac",
        "title": "Concubine",
        "artist": "Converge",
        "album_artist": "Converge",
        "album": "Jane Doe",
        "artist_id": 7,
        "duration": 94.0,
        "bliss_vector": None,
    }
    fallback = [
        {
            "track_id": 2,
            "track_path": "Botch/We Are the Romans/02 - To Our Friends in the Great White North.flac",
            "title": "To Our Friends in the Great White North",
            "artist": "Botch",
            "album": "We Are the Romans",
            "duration": 181.0,
            "score": 0.88,
        }
    ]

    with patch("crate.bliss.get_track_with_artist", return_value=source), \
         patch("crate.bliss._get_artist_genre_ids", return_value={"metalcore"}), \
         patch("crate.bliss._recommend_without_bliss", return_value=fallback) as recommend:
        result = get_similar_from_db(source["path"], limit=12, user_id=5)

    assert result == fallback
    recommend.assert_called_once_with(
        [source],
        exclude_paths=[source["path"]],
        limit=12,
        user_id=5,
        allow_seed_artists=False,
    )


def test_get_similar_from_db_scores_and_sorts_candidates():
    from crate.bliss import get_similar_from_db

    source = {
        "track_id": 1,
        "path": "/music/Converge/Jane Doe/01 - Concubine.flac",
        "title": "Concubine",
        "artist": "Converge",
        "album_artist": "Converge",
        "album": "Jane Doe",
        "artist_id": 7,
        "duration": 94.0,
        "bliss_vector": [0.1, 0.2],
    }
    candidates = [
        {
            "track_id": 2,
            "path": "/music/Cave In/Until Your Heart Stops/01 - Moral Eclipse.flac",
            "title": "Moral Eclipse",
            "artist": "Cave In",
            "album_artist": "Cave In",
            "album": "Until Your Heart Stops",
            "duration": 181.0,
        },
        {
            "track_id": 3,
            "path": "/music/Botch/We Are the Romans/02 - To Our Friends in the Great White North.flac",
            "title": "To Our Friends in the Great White North",
            "artist": "Botch",
            "album_artist": "Botch",
            "album": "We Are the Romans",
            "duration": 205.0,
        },
    ]

    def _score(candidate, seeds, source_genres, similar_artist_names):
        del seeds, source_genres, similar_artist_names
        return {
            candidates[0]["path"]: 0.41,
            candidates[1]["path"]: 0.93,
        }[candidate["path"]]

    with patch("crate.bliss.get_track_with_artist", return_value=source), \
         patch("crate.bliss._get_artist_genre_ids", return_value={"metalcore"}), \
         patch("crate.bliss.get_bliss_candidates", return_value=candidates), \
         patch(
             "crate.bliss._get_artist_genre_map",
             return_value={"Cave In": {"post-hardcore"}, "Botch": {"metalcore"}},
         ), \
         patch("crate.bliss._get_similar_artist_names", return_value={"Botch"}), \
         patch("crate.bliss._build_user_radio_profile", return_value={}), \
         patch("crate.bliss._score_candidate", side_effect=_score), \
         patch(
             "crate.bliss._apply_user_profile_score",
             side_effect=lambda candidate, score, user_profile: score,
         ):
        result = get_similar_from_db(source["path"], limit=2, user_id=9)

    assert [track["track_id"] for track in result] == [3, 2]
    assert result[0]["track_path"] == "Botch/We Are the Romans/02 - To Our Friends in the Great White North.flac"
    assert result[0]["score"] == 0.93
    assert result[1]["score"] == 0.41


def test_generate_track_radio_keeps_seed_first_and_deduplicates_paths():
    from crate.bliss import generate_track_radio

    seed = {
        "track_id": 1,
        "path": "/music/Converge/Jane Doe/01 - Concubine.flac",
        "title": "Concubine",
        "artist": "Converge",
        "album_artist": "Converge",
        "album": "Jane Doe",
        "artist_id": 7,
        "duration": 94.0,
    }
    same_artist_tracks = [
        {
            "track_id": 2,
            "path": "/music/Converge/Jane Doe/02 - Fault and Fracture.flac",
            "title": "Fault and Fracture",
            "artist": "Converge",
            "album_artist": "Converge",
            "album": "Jane Doe",
            "duration": 132.0,
        }
    ]
    similar_tracks = [
        {
            "track_id": 1,
            "track_path": "Converge/Jane Doe/01 - Concubine.flac",
            "title": "Concubine",
            "artist": "Converge",
            "album": "Jane Doe",
            "duration": 94.0,
            "score": 1.0,
        },
        {
            "track_id": 3,
            "track_path": "Botch/We Are the Romans/02 - To Our Friends in the Great White North.flac",
            "title": "To Our Friends in the Great White North",
            "artist": "Botch",
            "album": "We Are the Romans",
            "duration": 205.0,
            "score": 0.93,
        },
        {
            "track_id": 2,
            "track_path": "Converge/Jane Doe/02 - Fault and Fracture.flac",
            "title": "Fault and Fracture",
            "artist": "Converge",
            "album": "Jane Doe",
            "duration": 132.0,
            "score": 0.71,
        },
    ]

    with patch("crate.bliss.get_track_with_artist", return_value=seed), \
         patch("crate.bliss.get_same_artist_tracks", return_value=same_artist_tracks), \
         patch("crate.bliss.get_similar_from_db", return_value=similar_tracks):
        result = generate_track_radio(seed["path"], limit=4, mix_ratio=0.25, user_id=3)

    assert result[0]["track_path"] == "Converge/Jane Doe/01 - Concubine.flac"
    assert len({track["track_path"] for track in result}) == len(result)
    assert "Botch/We Are the Romans/02 - To Our Friends in the Great White North.flac" in {
        track["track_path"] for track in result
    }
    assert "Converge/Jane Doe/02 - Fault and Fracture.flac" in {
        track["track_path"] for track in result
    }
