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

    def test_stats_dashboard_bundles_the_full_payload(self, test_app):
        overview = {
            "window": "90d",
            "play_count": 48,
            "complete_play_count": 21,
            "skip_count": 9,
            "minutes_listened": 183.5,
            "active_days": 12,
            "skip_rate": 0.1875,
            "top_artist": {"artist_name": "Converge", "play_count": 10, "minutes_listened": 31.0},
        }
        trends = {"window": "90d", "points": [{"day": "2026-04-01", "play_count": 4, "complete_play_count": 2, "skip_count": 1, "minutes_listened": 18.5}]}
        top_tracks = [{
            "track_id": 99,
            "track_path": "/music/Converge/Jane Doe/01 - Concubine.flac",
            "title": "Concubine",
            "artist": "Converge",
            "album": "Jane Doe",
            "play_count": 7,
            "complete_play_count": 3,
            "minutes_listened": 8.2,
        }]
        top_artists = [{"artist_name": "Converge", "artist_id": 7, "play_count": 7, "complete_play_count": 3, "minutes_listened": 8.2}]
        top_albums = [{"artist": "Converge", "album": "Jane Doe", "album_id": 11, "play_count": 7, "complete_play_count": 3, "minutes_listened": 8.2}]
        top_genres = [{"genre_name": "metalcore", "play_count": 7, "complete_play_count": 3, "minutes_listened": 8.2}]
        replay = {
            "window": "90d",
            "title": "Replay this quarter",
            "subtitle": "The tracks that defined the last 90 days.",
            "track_count": 1,
            "minutes_listened": 8.2,
            "items": top_tracks,
        }

        with patch("crate.api.me.get_cache", return_value=None), \
             patch("crate.api.me.set_cache") as mock_set_cache, \
             patch("crate.api.me.get_stats_overview", return_value=overview) as mock_overview, \
             patch("crate.api.me.get_stats_trends", return_value=trends) as mock_trends, \
             patch("crate.api.me.get_top_tracks", return_value=top_tracks) as mock_top_tracks, \
             patch("crate.api.me.get_top_artists", return_value=top_artists) as mock_top_artists, \
             patch("crate.api.me.get_top_albums", return_value=top_albums) as mock_top_albums, \
             patch("crate.api.me.get_top_genres", return_value=top_genres) as mock_top_genres, \
             patch("crate.api.me.get_replay_mix", return_value=replay) as mock_replay:
            resp = test_app.get(
                "/api/me/stats/dashboard"
                "?window=90d&tracks_limit=5&artists_limit=4&albums_limit=3&genres_limit=2&replay_limit=9"
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["window"] == "90d"
        assert data["overview"]["play_count"] == 48
        assert data["trends"]["points"][0]["day"] == "2026-04-01"
        assert data["top_tracks"]["items"][0]["title"] == "Concubine"
        assert data["top_artists"]["items"][0]["artist_name"] == "Converge"
        assert data["top_albums"]["items"][0]["album"] == "Jane Doe"
        assert data["top_genres"]["items"][0]["genre_name"] == "metalcore"
        assert data["replay"]["title"] == "Replay this quarter"

        mock_overview.assert_called_once_with(1, window="90d")
        mock_trends.assert_called_once_with(1, window="90d")
        mock_top_tracks.assert_called_once_with(1, window="90d", limit=5)
        mock_top_artists.assert_called_once_with(1, window="90d", limit=4)
        mock_top_albums.assert_called_once_with(1, window="90d", limit=3)
        mock_top_genres.assert_called_once_with(1, window="90d", limit=2)
        mock_replay.assert_called_once_with(1, window="90d", limit=9)
        mock_set_cache.assert_called_once()
