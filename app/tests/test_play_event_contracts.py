"""Contracts for rich user play-event tracking."""

from unittest.mock import patch


class TestPlayEventContract:
    def test_play_event_endpoint_persists_event_payload(self, test_app):
        payload = {
            "client_event_id": "evt_abc123",
            "track_id": 12,
            "track_path": "Converge/Jane Doe/01 - Concubine.flac",
            "title": "Concubine",
            "artist": "Converge",
            "album": "Jane Doe",
            "started_at": "2026-04-01T10:00:00Z",
            "ended_at": "2026-04-01T10:01:34Z",
            "played_seconds": 73.2,
            "track_duration_seconds": 94.0,
            "completion_ratio": 0.779,
            "was_skipped": True,
            "was_completed": False,
            "play_source_type": "album",
            "play_source_id": "44",
            "play_source_name": "Jane Doe",
            "context_artist": "Converge",
            "context_album": "Jane Doe",
            "context_playlist_id": None,
            "device_type": "web",
            "app_platform": "listen-web",
        }

        with patch("crate.api.me.record_play_event", return_value=77) as mock_record:
            resp = test_app.post("/api/me/play-events", json=payload)

        assert resp.status_code == 200
        assert resp.json() == {"ok": True, "id": 77}
        mock_record.assert_called_once_with(
            1,
            client_event_id="evt_abc123",
            track_id=12,
            track_path="Converge/Jane Doe/01 - Concubine.flac",
            track_storage_id=None,
            title="Concubine",
            artist="Converge",
            album="Jane Doe",
            started_at="2026-04-01T10:00:00+00:00",
            ended_at="2026-04-01T10:01:34+00:00",
            played_seconds=73.2,
            track_duration_seconds=94.0,
            completion_ratio=0.779,
            was_skipped=True,
            was_completed=False,
            play_source_type="album",
            play_source_id="44",
            play_source_name="Jane Doe",
            context_artist="Converge",
            context_album="Jane Doe",
            context_playlist_id=None,
            device_type="web",
            app_platform="listen-web",
        )

    def test_play_event_endpoint_rejects_inconsistent_completion_flags(self, test_app):
        payload = {
            "track_id": 12,
            "track_path": "Converge/Jane Doe/01 - Concubine.flac",
            "title": "Concubine",
            "artist": "Converge",
            "album": "Jane Doe",
            "started_at": "2026-04-01T10:00:00Z",
            "ended_at": "2026-04-01T10:01:34Z",
            "played_seconds": 73.2,
            "track_duration_seconds": 94.0,
            "completion_ratio": 0.779,
            "was_skipped": True,
            "was_completed": True,
        }

        resp = test_app.post("/api/me/play-events", json=payload)

        assert resp.status_code == 422
