"""Contract tests for stats API MVP."""

from unittest.mock import patch


class TestStatsApiContracts:
    def test_stats_overview_returns_backend_payload(self, test_app):
        payload = {
            "window": "30d",
            "play_count": 48,
            "complete_play_count": 21,
            "skip_count": 9,
            "minutes_listened": 183.5,
            "active_days": 12,
            "skip_rate": 0.1875,
            "top_artist": {"artist_name": "Converge", "play_count": 10, "minutes_listened": 31.0},
        }

        with patch("crate.api.me.get_stats_overview", return_value=payload) as mock_get:
            resp = test_app.get("/api/me/stats/overview?window=30d")

        assert resp.status_code == 200
        data = resp.json()
        for key in ("window", "play_count", "complete_play_count", "skip_count",
                     "minutes_listened", "active_days", "skip_rate"):
            assert data[key] == payload[key]
        assert data["top_artist"]["artist_name"] == "Converge"
        assert data["top_artist"]["play_count"] == 10
        mock_get.assert_called_once_with(1, window="30d")

    def test_stats_top_tracks_wraps_items_and_window(self, test_app):
        items = [{
            "track_id": 99,
            "track_path": "/music/Converge/Jane Doe/01 - Concubine.flac",
            "title": "Concubine",
            "artist": "Converge",
            "album": "Jane Doe",
            "play_count": 7,
            "complete_play_count": 3,
            "minutes_listened": 8.2,
            "first_played_at": "2026-03-01T10:00:00Z",
            "last_played_at": "2026-04-01T10:00:00Z",
        }]

        with patch("crate.api.me.get_top_tracks", return_value=items) as mock_get:
            resp = test_app.get("/api/me/stats/top-tracks?window=90d&limit=5")

        assert resp.status_code == 200
        data = resp.json()
        assert data["window"] == "90d"
        assert len(data["items"]) == 1
        item = data["items"][0]
        assert item["track_id"] == 99
        assert item["title"] == "Concubine"
        assert item["artist"] == "Converge"
        assert item["play_count"] == 7
        mock_get.assert_called_once_with(1, window="90d", limit=5)

    def test_stats_invalid_window_returns_400(self, test_app):
        with patch(
            "crate.api.me.get_stats_trends",
            side_effect=ValueError("Unsupported stats window: banana"),
        ):
            resp = test_app.get("/api/me/stats/trends?window=banana")

        assert resp.status_code == 400
        assert resp.json()["detail"] == "Unsupported stats window: banana"

    def test_stats_replay_returns_playable_payload(self, test_app):
        payload = {
            "window": "30d",
            "title": "Replay this month",
            "subtitle": "The tracks that defined your last 30 days.",
            "track_count": 2,
            "minutes_listened": 42.5,
            "items": [{
                "track_id": 99,
                "track_path": "/music/Converge/Jane Doe/01 - Concubine.flac",
                "title": "Concubine",
                "artist": "Converge",
                "album": "Jane Doe",
                "play_count": 7,
                "complete_play_count": 3,
                "minutes_listened": 8.2,
            }],
        }

        with patch("crate.api.me.get_replay_mix", return_value=payload) as mock_get:
            resp = test_app.get("/api/me/stats/replay?window=30d&limit=25")

        assert resp.status_code == 200
        data = resp.json()
        assert data["window"] == "30d"
        assert data["title"] == "Replay this month"
        assert data["track_count"] == 2
        assert len(data["items"]) == 1
        item = data["items"][0]
        assert item["track_id"] == 99
        assert item["title"] == "Concubine"
        assert item["artist"] == "Converge"
        mock_get.assert_called_once_with(1, window="30d", limit=25)
