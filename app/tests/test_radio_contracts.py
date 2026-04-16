"""Regression contracts for unified radio endpoints."""

from unittest.mock import patch


class TestRadioApiContracts:
    def test_artist_radio_returns_session_and_tracks(self, test_app):
        tracks = [
            {
                "track_id": 42,
                "track_path": "Converge/Jane Doe/01 - Concubine.flac",
                "title": "Concubine",
                "artist": "Converge",
                "album": "Jane Doe",
                "duration": 94.0,
                "score": 0.92,
            }
        ]

        with patch("crate.api.radio.get_library_artist_by_id", return_value={"id": 7, "name": "Converge", "slug": "converge"}), \
             patch("crate.api.radio.generate_artist_radio", return_value=tracks):
            resp = test_app.get("/api/artists/7/radio?limit=25")

        assert resp.status_code == 200
        data = resp.json()
        assert data["session"] == {
            "type": "artist",
            "name": "Converge Radio",
            "seed": {"artist_id": 7, "artist_name": "Converge"},
        }
        assert data["tracks"] == tracks

    def test_track_radio_accepts_track_id_and_returns_tracks(self, test_app):
        tracks = [
            {
                "track_id": 99,
                "track_path": "Converge/Jane Doe/01 - Concubine.flac",
                "title": "Concubine",
                "artist": "Converge",
                "album": "Jane Doe",
                "duration": 94.0,
                "score": None,
            },
            {
                "track_id": 123,
                "track_path": "Botch/We Are the Romans/02 - To Our Friends in the Great White North.flac",
                "title": "To Our Friends in the Great White North",
                "artist": "Botch",
                "album": "We Are the Romans",
                "duration": 181.0,
                "score": 0.88,
            },
        ]

        with patch("crate.api.radio._resolve_track_path", return_value="/music/Converge/Jane Doe/01 - Concubine.flac"), \
             patch("crate.api.radio.generate_track_radio", return_value=tracks):
            resp = test_app.get("/api/radio/track?track_id=99&limit=50")

        assert resp.status_code == 200
        data = resp.json()
        assert data["session"]["type"] == "track"
        assert data["session"]["seed"]["track_id"] == 99
        assert data["session"]["seed"]["track_path"] == "Converge/Jane Doe/01 - Concubine.flac"
        assert data["tracks"][1]["artist"] == "Botch"

    def test_album_radio_returns_session_and_tracks(self, test_app):
        tracks = [
            {
                "track_id": 10,
                "track_path": "Converge/Jane Doe/01 - Concubine.flac",
                "title": "Concubine",
                "artist": "Converge",
                "album": "Jane Doe",
                "duration": 94.0,
                "score": None,
            }
        ]

        with patch("crate.api.radio.get_album_for_radio", return_value={
                "artist": "Converge",
                "name": "Jane Doe",
             }), \
             patch("crate.api.radio.generate_album_radio", return_value=tracks):
            resp = test_app.get("/api/radio/album/5?limit=50")

        assert resp.status_code == 200
        data = resp.json()
        assert data["session"]["type"] == "album"
        assert data["session"]["seed"]["album_id"] == 5
        assert data["tracks"][0]["album"] == "Jane Doe"

    def test_playlist_radio_returns_session_and_tracks(self, test_app):
        tracks = [
            {
                "track_id": 77,
                "track_path": "Converge/Jane Doe/11 - Jane Doe.flac",
                "title": "Jane Doe",
                "artist": "Converge",
                "album": "Jane Doe",
                "duration": 690.0,
                "score": 0.84,
            }
        ]

        with patch("crate.api.radio.get_playlist_for_radio", return_value={
                "id": 7,
                "name": "Hardcore",
                "scope": "system",
                "user_id": None,
                "is_active": True,
             }), \
             patch("crate.api.radio.generate_playlist_radio", return_value=tracks):
            resp = test_app.get("/api/radio/playlist/7?limit=50")

        assert resp.status_code == 200
        data = resp.json()
        assert data["session"]["type"] == "playlist"
        assert data["session"]["seed"]["playlist_id"] == 7
        assert data["tracks"][0]["title"] == "Jane Doe"

    def test_playlist_radio_hides_inactive_system_playlists(self, test_app):
        with patch("crate.api.radio.get_playlist_for_radio", return_value={
                "id": 12,
                "name": "Hidden Editorial",
                "scope": "system",
                "user_id": None,
                "is_active": False,
             }):
            resp = test_app.get("/api/radio/playlist/12?limit=50")

        assert resp.status_code == 404

    def test_radio_endpoints_clamp_limit(self, test_app):
        with patch("crate.api.radio.get_library_artist_by_id", return_value={"id": 7, "name": "Converge", "slug": "converge"}):
            resp = test_app.get("/api/artists/7/radio?limit=101")
        assert resp.status_code == 422
