"""Regression contracts for unified radio endpoints."""

from unittest.mock import patch


class TestRadioApiContracts:
    def test_artist_radio_returns_session_and_tracks(self, test_app):
        tracks = [
            {
                "track_id": 42,
                "navidrome_id": "nd-42",
                "track_path": "Converge/Jane Doe/01 - Concubine.flac",
                "title": "Concubine",
                "artist": "Converge",
                "album": "Jane Doe",
                "duration": 94.0,
                "score": 0.92,
            }
        ]

        with patch("crate.api.radio.generate_artist_radio", return_value=tracks):
            resp = test_app.get("/api/radio/artist/Converge?limit=25")

        assert resp.status_code == 200
        data = resp.json()
        assert data["session"] == {
            "type": "artist",
            "name": "Converge Radio",
            "seed": {"artist_name": "Converge"},
        }
        assert data["tracks"] == tracks

    def test_track_radio_accepts_track_id_and_returns_tracks(self, test_app):
        tracks = [
            {
                "track_id": 99,
                "navidrome_id": "nd-99",
                "track_path": "Converge/Jane Doe/01 - Concubine.flac",
                "title": "Concubine",
                "artist": "Converge",
                "album": "Jane Doe",
                "duration": 94.0,
                "score": None,
            },
            {
                "track_id": 123,
                "navidrome_id": "nd-123",
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
